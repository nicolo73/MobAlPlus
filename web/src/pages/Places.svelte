<script lang="ts">
  import { api } from "../lib/api";
  import type { Place } from "../lib/types";
  import { isWithin, placeOrder } from "../lib/placetree";
  import { isDark, placeColor } from "../lib/colors";
  import ColorPicker from "../components/ColorPicker.svelte";

  const dark = isDark();

  type Draft = Omit<Place, "id"> & { id?: number };
  const EXPOSURES: Record<string, string> = { indoor: "intérieur", outdoor: "extérieur", appliance: "appareil" };

  let places = $state<Place[] | null>(null);
  let draft = $state<Draft | null>(null);
  let error = $state("");
  let busy = $state(false);
  /** Glisser-déposer : emplacement déplacé, et cible survolée */
  let dragged = $state<number | null>(null);
  let target = $state<{ id: number; where: "before" | "inside" | "after" } | null>(null);

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
      const all = places ?? [];
      const old = all.find((p) => p.id === draft!.id);
      // Nouvel emplacement, ou changement de parent : il se range en dernier parmi ses voisins
      if (all.some((p) => "sort_order" in p) && (!old || old.parent_id !== draft.parent_id)) {
        draft.sort_order = Math.max(0, ...all.filter((p) => p.parent_id === draft!.parent_id).map((p) => p.sort_order ?? 0)) + 1;
      }
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

  const siblingsOf = (parent: number | null, except?: number) =>
    (places ?? []).filter((p) => p.parent_id === parent && p.id !== except).sort(placeOrder);

  /** Arborescence : chaque emplacement suivi de ses enfants, avec sa profondeur */
  const tree = $derived.by(() => {
    const out: { place: Place; depth: number; index: number; count: number }[] = [];
    const walk = (parent: number | null, depth: number) => {
      const sibs = siblingsOf(parent);
      sibs.forEach((p, index) => {
        out.push({ place: p, depth, index, count: sibs.length });
        walk(p.id, depth + 1);
      });
    };
    walk(null, 0);
    return out;
  });

  /** Range `id` sous `parent`, à la position `index` parmi ses nouveaux voisins */
  async function move(id: number, parent: number | null, index: number) {
    if (parent !== null && isWithin(places ?? [], parent, id)) {
      error = "Un emplacement ne peut pas être placé dans l'un de ses sous-emplacements.";
      return;
    }
    const ids = siblingsOf(parent, id).map((p) => p.id);
    ids.splice(Math.max(0, Math.min(index, ids.length)), 0, id);
    error = "";
    busy = true;
    try {
      await api.reorderPlaces(parent, ids);
      await load();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  const up = (p: Place, index: number) => move(p.id, p.parent_id, index - 1);
  const down = (p: Place, index: number) => move(p.id, p.parent_id, index + 1);
  /** Sortir du parent : se place juste après lui */
  function outdent(p: Place) {
    const parent = (places ?? []).find((x) => x.id === p.parent_id);
    if (!parent) return;
    move(p.id, parent.parent_id, siblingsOf(parent.parent_id).findIndex((x) => x.id === parent.id) + 1);
  }
  /** Entrer dans l'emplacement précédent, en dernier */
  function indent(p: Place, index: number) {
    const prev = siblingsOf(p.parent_id)[index - 1];
    if (prev) move(p.id, prev.id, siblingsOf(prev.id).length);
  }

  function dragOver(e: DragEvent, p: Place) {
    if (dragged === null || dragged === p.id || isWithin(places ?? [], p.id, dragged)) { target = null; return; }
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    target = { id: p.id, where: y < 0.3 ? "before" : y > 0.7 ? "after" : "inside" };
  }
  function drop(e: DragEvent, p: Place) {
    e.preventDefault();
    const t = target, id = dragged;
    dragged = target = null;
    if (!t || id === null) return;
    if (t.where === "inside") move(id, p.id, siblingsOf(p.id, id).length);
    else {
      const index = siblingsOf(p.parent_id, id).findIndex((x) => x.id === p.id);
      move(id, p.parent_id, t.where === "before" ? index : index + 1);
    }
  }
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
        <div class="field">Couleur dans les courbes
          <ColorPicker value={draft.color ?? draft.color_slot ?? null} {dark} onchange={(v) => {
            if (!draft) return;
            draft.color_slot = typeof v === "number" ? v : null;
            draft.color = typeof v === "string" ? v : null;
          }} />
        </div>
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
      <p class="muted hint">Glisser un emplacement sur un autre pour l'y ranger (au milieu de la ligne) ou le placer
        avant / après ; ou utiliser les flèches.</p>
      <ul class="tree" class:busy>
        {#each tree as { place, depth, index, count } (place.id)}
          {@const t = target?.id === place.id ? target.where : null}
          <li style="--depth:{depth}" draggable="true" class:dragging={dragged === place.id}
              class:before={t === "before"} class:after={t === "after"} class:inside={t === "inside"}
              ondragstart={(e) => { dragged = place.id; e.dataTransfer?.setData("text/plain", String(place.id)); }}
              ondragend={() => (dragged = target = null)}
              ondragover={(e) => dragOver(e, place)} ondragleave={() => { if (target?.id === place.id) target = null; }}
              ondrop={(e) => drop(e, place)}>
            <span class="handle" aria-hidden="true">⠿</span>
            {#if depth}<span class="elbow" aria-hidden="true">└</span>{/if}
            <span class="name">{place.name}</span>
            {#if place.color != null || place.color_slot != null}<span class="dot" style="--c:{placeColor(place, dark, 0)}" title="couleur dans les courbes"></span>{/if}
            <span class="badge">{EXPOSURES[place.exposure ?? ""] ?? "–"}</span>
            <span class="spacer"></span>
            <span class="actions">
            <span class="moves">
              <button class="icon" disabled={busy || index === 0} onclick={() => up(place, index)}
                      title="Monter" aria-label="Monter {place.name}">↑</button>
              <button class="icon" disabled={busy || index === count - 1} onclick={() => down(place, index)}
                      title="Descendre" aria-label="Descendre {place.name}">↓</button>
              <button class="icon" disabled={busy || !place.parent_id} onclick={() => outdent(place)}
                      title="Sortir de l'emplacement parent" aria-label="Sortir {place.name} de son parent">←</button>
              <button class="icon" disabled={busy || index === 0} onclick={() => indent(place, index)}
                      title="Ranger dans l'emplacement au-dessus" aria-label="Ranger {place.name} dans l'emplacement au-dessus">→</button>
            </span>
            <button class="link" onclick={() => edit(place)}>modifier</button>
            <button class="link danger" onclick={() => remove(place)}>supprimer</button>
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

<style>
  .tree { list-style: none; margin: 0; padding: 0; }
  .tree li { display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 0.5rem; padding: 0.4rem 0;
             padding-left: calc(var(--depth) * var(--indent, 1.5rem)); border-bottom: 1px solid var(--border); cursor: grab;
             border-top: 2px solid transparent; }
  .tree.busy { opacity: 0.6; pointer-events: none; }
  .tree li.dragging { opacity: 0.4; }
  .tree li.before { border-top-color: var(--primary); }
  .tree li.after { border-bottom: 2px solid var(--primary); }
  .tree li.inside { background: var(--primary-soft); }
  .handle { color: var(--muted); cursor: grab; }
  .elbow { color: var(--muted); }
  .name { font-weight: 500; }
  .dot { display: inline-block; width: 0.75rem; height: 0.75rem; border-radius: 50%; background: var(--c); }
  .field { display: grid; gap: 0.35rem; font-size: 0.9rem; }
  .actions { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 0.35rem; margin-left: auto; white-space: nowrap; }
  @media (max-width: 600px) { .tree { --indent: 0.8rem; } }
  .moves { display: inline-flex; gap: 0.15rem; }
  .icon { min-height: 2rem; min-width: 2rem; padding: 0.1rem 0.4rem; justify-content: center; }
  .hint { margin: 0 0 0.5rem; font-size: 0.85rem; }
  .tree li:last-child { border-bottom: none; }
  .danger { color: var(--err); }
</style>
