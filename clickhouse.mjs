// Accès à ClickHouse par son interface HTTP, sans dépendance : le projet n'en a
// aucune et l'API HTTP suffit pour insérer et interroger.
//
// L'écriture passe directement par cette couche. La lecture par l'agent passe,
// elle, par le serveur MCP officiel (mcp-clickhouse) : c'est lui qui expose les
// tables au modèle.

const DDL = [
  `CREATE TABLE IF NOT EXISTS production_events (
    project_id   LowCardinality(String),
    event_id     String,
    type         LowCardinality(String),
    operation    LowCardinality(String),
    target_type  LowCardinality(String),
    target_id    String,
    media_id     String,
    approval_id  String,
    revision     UInt32,
    at           DateTime64(3, 'UTC')
  ) ENGINE = MergeTree
  ORDER BY (project_id, at, event_id)`,

  // Une ligne par média généré : c'est la table qui porte le coût réel.
  `CREATE TABLE IF NOT EXISTS media_generations (
    project_id    LowCardinality(String),
    media_id      String,
    target_type   LowCardinality(String),
    target_id     String,
    kind          LowCardinality(String),
    purpose       LowCardinality(String),
    provider      LowCardinality(String),
    model         LowCardinality(String),
    version       UInt16,
    status        LowCardinality(String),
    cost_usd      Float64,
    seconds       Float32,
    frames_used   UInt8,
    start_from    LowCardinality(String),
    chain_depth   UInt8,
    reanchored    UInt8,
    created_at    DateTime64(3, 'UTC')
  ) ENGINE = MergeTree
  ORDER BY (project_id, created_at, media_id)`,

  // Les tables existantes ne sont pas recréées : les colonnes de provenance
  // doivent être ajoutées explicitement.
  `ALTER TABLE media_generations ADD COLUMN IF NOT EXISTS source_shot_version UInt16 DEFAULT 0`,
  `ALTER TABLE media_generations ADD COLUMN IF NOT EXISTS source_refs String DEFAULT ''`,

  // Les décisions humaines : ce qui a été proposé, accepté, refusé, et en
  // combien de temps. C'est la mesure de la friction que l'agent doit réduire.
  `CREATE TABLE IF NOT EXISTS approvals (
    project_id   LowCardinality(String),
    approval_id  String,
    operation    LowCardinality(String),
    source       LowCardinality(String),
    status       LowCardinality(String),
    created_at   DateTime64(3, 'UTC'),
    decided_at   Nullable(DateTime64(3, 'UTC')),
    decision_ms  Nullable(UInt32)
  ) ENGINE = MergeTree
  ORDER BY (project_id, created_at, approval_id)`,
];

export function clickhouseConfig(values = {}) {
  const url = String(values.CLICKHOUSE_URL || "").trim().replace(/\/+$/, "");
  if (!url) return null;
  if (!/^https:\/\//.test(url)) {
    throw new Error("CLICKHOUSE_URL doit être une URL https.");
  }
  const password = String(values.CLICKHOUSE_PASSWORD || "");
  if (!password) throw new Error("CLICKHOUSE_PASSWORD manque pour ClickHouse.");
  return {
    url,
    user: String(values.CLICKHOUSE_USER || "default"),
    password,
    database: String(values.CLICKHOUSE_DATABASE || "cinemai"),
  };
}

export function createClickhouseClient({ config, fetchImpl = fetch, timeoutMs = 15_000 } = {}) {
  if (!config) return null;
  const headers = {
    "X-ClickHouse-User": config.user,
    "X-ClickHouse-Key": config.password,
    "Content-Type": "text/plain; charset=utf-8",
  };

  async function send(sql, { database = config.database, body, timeout = timeoutMs } = {}) {
    const target = new URL(config.url);
    target.searchParams.set("query", sql);
    if (database) target.searchParams.set("database", database);
    let response;
    try {
      response = await fetchImpl(target.toString(), {
        method: "POST",
        headers,
        body: body ?? "",
        signal: AbortSignal.timeout(timeout),
      });
    } catch (error) {
      if (error?.name === "TimeoutError" || error?.name === "AbortError") {
        throw Object.assign(new Error("ClickHouse a dépassé le délai prévu."), { status: 504 });
      }
      throw Object.assign(new Error("Impossible de joindre ClickHouse."), { status: 502 });
    }
    const text = await response.text();
    if (!response.ok) {
      throw Object.assign(new Error(`ClickHouse a refusé la requête : ${text.slice(0, 300)}`), { status: 502 });
    }
    return text;
  }

  return {
    async ensureSchema() {
      // Un ALTER sur un cluster qui sort de veille dépasse largement le délai
      // d'une requête ordinaire.
      const ddlTimeout = Math.max(timeoutMs, 90_000);
      await send(`CREATE DATABASE IF NOT EXISTS ${config.database}`, { database: null, timeout: ddlTimeout });
      for (const statement of DDL) await send(statement, { timeout: ddlTimeout });
    },

    async insert(table, rows) {
      if (!Array.isArray(rows) || !rows.length) return 0;
      const body = rows.map((row) => JSON.stringify(row)).join("\n");
      await send(`INSERT INTO ${table} FORMAT JSONEachRow`, { body });
      return rows.length;
    },

    async query(sql) {
      const text = await send(`${sql} FORMAT JSON`);
      try {
        return JSON.parse(text).data || [];
      } catch {
        throw Object.assign(new Error("ClickHouse a renvoyé une réponse illisible."), { status: 502 });
      }
    },
  };
}

const asDateTime = (value) => new Date(value || Date.now()).toISOString().replace("T", " ").replace("Z", "");

// Les lignes dérivent du manifeste : aucune donnée n'est inventée pour la
// démonstration, on déplace ce que la production produit déjà.
export function eventRows(projectId, activity = []) {
  return activity.map((event) => ({
    project_id: projectId,
    event_id: String(event.id || ""),
    type: String(event.type || ""),
    operation: String(event.operation || ""),
    target_type: String(event.targetType || ""),
    target_id: String(event.targetId || ""),
    media_id: String(event.mediaId || ""),
    approval_id: String(event.approvalId || ""),
    revision: Number(event.revision || 0),
    at: asDateTime(event.at),
  }));
}

export function mediaRows(projectId, media = [], extras = {}) {
  return media.map((item) => {
    const extra = extras[item.id] || {};
    return {
      project_id: projectId,
      media_id: String(item.id || ""),
      target_type: String(item.targetType || ""),
      target_id: String(item.targetId || ""),
      kind: String(item.kind || ""),
      purpose: String(item.purpose || ""),
      provider: String(item.provider || ""),
      model: String(item.model || ""),
      version: Number(item.version || 0),
      status: String(item.status || ""),
      cost_usd: Number(item.estimatedCostUsd || 0),
      seconds: Number(extra.seconds || 0),
      frames_used: Number(extra.framesUsed || 0),
      start_from: String(extra.startFrom || ""),
      chain_depth: Number(extra.chainDepth || 0),
      reanchored: extra.reanchored ? 1 : 0,
      // Provenance sérialisée : de quelle version de scénario et de quelles
      // planches exactes cette image descend.
      source_shot_version: Number(item.sourceShotVersion || 0),
      source_refs: JSON.stringify(item.sourceRefs || []),
      created_at: asDateTime(item.createdAt),
    };
  });
}

export function approvalRows(projectId, approvals = []) {
  return approvals.map((approval) => {
    const created = approval.createdAt ? new Date(approval.createdAt) : null;
    const decided = approval.decidedAt ? new Date(approval.decidedAt) : null;
    return {
      project_id: projectId,
      approval_id: String(approval.id || ""),
      operation: String(approval.operation?.name || ""),
      source: String(approval.source || ""),
      status: String(approval.status || ""),
      created_at: asDateTime(approval.createdAt),
      decided_at: decided ? asDateTime(approval.decidedAt) : null,
      decision_ms: created && decided ? Math.max(0, decided.getTime() - created.getTime()) : null,
    };
  });
}
