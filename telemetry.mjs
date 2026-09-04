// Déverse la télémétrie de production dans ClickHouse.
//
// Le manifeste reste la source de vérité : ClickHouse en reçoit une copie
// analytique, que l'agent interroge ensuite via le serveur MCP. La synchro est
// incrémentale et sans état persistant — on retient en mémoire ce qui a déjà
// été envoyé, et une reprise à froid réinsère au pire des doublons, que les
// requêtes dédupliquent par identifiant.

import { approvalRows, eventRows, mediaRows } from "./clickhouse.mjs";

export function createTelemetry({ client, logger = console } = {}) {
  if (!client) {
    // Sans ClickHouse configuré, la production continue normalement.
    return { enabled: false, async sync() { return { events: 0, media: 0, approvals: 0 }; } };
  }
  const sentEvents = new Set();
  const sentApprovals = new Map();
  const sentMedia = new Set();
  let schemaReady = false;

  return {
    enabled: true,

    async sync(snapshot, extras = {}) {
      const projectId = snapshot?.project?.id;
      if (!projectId) return { events: 0, media: 0, approvals: 0 };
      try {
        if (!schemaReady) {
          await client.ensureSchema();
          schemaReady = true;
        }

        const events = (snapshot.activity || []).filter((item) => item.id && !sentEvents.has(item.id));
        const media = (snapshot.media || []).filter((item) => item.id && !sentMedia.has(item.id));
        // Une proposition est réécrite quand elle passe de pending à décidée :
        // on la renvoie tant que son statut change.
        const approvals = (snapshot.approvals || []).filter(
          (item) => item.id && sentApprovals.get(item.id) !== item.status,
        );

        await client.insert("production_events", eventRows(projectId, events));
        await client.insert("media_generations", mediaRows(projectId, media, extras));
        await client.insert("approvals", approvalRows(projectId, approvals));

        events.forEach((item) => sentEvents.add(item.id));
        media.forEach((item) => sentMedia.add(item.id));
        approvals.forEach((item) => sentApprovals.set(item.id, item.status));
        return { events: events.length, media: media.length, approvals: approvals.length };
      } catch (error) {
        // La télémétrie ne doit jamais faire échouer une production.
        logger.warn?.(`Télémétrie ClickHouse indisponible : ${error.message}`);
        return { events: 0, media: 0, approvals: 0, error: error.message };
      }
    },
  };
}
