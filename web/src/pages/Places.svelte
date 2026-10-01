<script lang="ts">
  import { api } from "../lib/api";
  import type { Place } from "../lib/types";

  type Draft = Omit<Place, "id"> & { id?: number };
  const EXPOSURES: Record<string, string> = { indoor: "intérieur", outdoor: "extérieur", appliance: "appareil" };

  let places = $state<Place[] | null>(null);
  let draft = $state<Draft | null>(null);
  let error = $state("");

  async function load() {
    try {
      places = await api.places();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  load();

  const slug = (s: string) =>
    s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  function edit(p?: Place) {
    draft = p ? { ...p } : { code: "", name: "", parent_id: null, kind: "room", exposure: "indoor" };
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (!draft) return;
    error = "";
    try {
      await api.savePlace({ ...draft, code: draft.code || slug(draft.name) });
      draft = null;
      await load();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function remove(p: Place) {
    if (!confirm(`Supprimer l'emplacement « ${p.name} » ?`)) return;
    error = "";
    try {
      await api.deletePlace(p.id);
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      error = /foreign key|violates/i.test(msg)
        ? "Cet emplacement est utilisé (affectations, sous-emplacements ou mesures) : il ne peut pas être supprimé."
        : msg;
    }
  }

  /** Arborescence : chaque emplacement suivi de ses enfants, avec sa profondeur */
  const tree = $derived.by(() => {
    const all = places ?? [];
    const out: { place: Place; depth: number }[] = [];
    const walk = (parent: number | null, depth: number) => {
      for (const p of all.filter((x) => x.parent_id === parent)) {
        out.push({ place: p, depth });
        walk(p.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  });
</script>

<div class="stack">
  <div class="row">
    <h2 style="margin:0">Emplacements</h2>
    <span class="spacer"></span>
    <button class="primary" onclick={() => edit()}>Nouvel emplacement</button>
  </div>

  {#if error}<div class="notice err" role="alert">{error}</div>{/if}

  {#if draft}
    <form class="card stack" onsubmit={save}>
      <h3>{draft.id ? "Modifier" : "Nouvel emplacement"}</h3>
      <div class="grid">
        <label>Nom <input required bind:value={draft.name} /></label>
        <label>Dans
          <select bind:value={draft.parent_id}>
            <option value={null}>— aucun —</option>
            {#each (places ?? []).filter((p) => p.id !== draft?.id) as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
          </select>
        </label>
        <label>Exposition
          <select bind:value={draft.exposure}>
            {#each Object.entries(EXPOSURES) as [v, l] (v)}<option value={v}>{l}</option>{/each}
          </select>
        </label>
      </div>
      <div class="row">
        <button class="primary" type="submit">Enregistrer</button>
        <button type="button" onclick={() => (draft = null)}>Annuler</button>
      </div>
    </form>
  {/if}

  <div class="card">
    {#if places === null}
      <p class="muted">Chargement…</p>
    {:else if places.length === 0}
      <p class="muted">Aucun emplacement.</p>
    {:else}
      <ul class="tree">
        {#each tree as { place, depth } (place.id)}
          <li style="padding-left:{depth * 1.25}rem">
            <span>{place.name}</span>
            <span class="badge">{EXPOSURES[place.exposure ?? ""] ?? "–"}</span>
            <span class="spacer"></span>
            <button class="link" onclick={() => edit(place)}>modifier</button>
            <button class="link danger" onclick={() => remove(place)}>supprimer</button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

<style>
  .tree { list-style: none; margin: 0; padding: 0; }
  .tree li { display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 0.5rem; padding-top: 0.4rem; padding-bottom: 0.4rem;
             border-bottom: 1px solid var(--border); }
  .tree li:last-child { border-bottom: none; }
  .danger { color: var(--err); }
</style>
