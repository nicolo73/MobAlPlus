<script lang="ts">
  import { loadContext, ctx } from "../lib/home.svelte";

  let busy = $state(false);
  async function refresh() {
    busy = true;
    try { await loadContext(); } finally { busy = false; }
  }
</script>

<div class="card stack welcome">
  <h1 style="margin:0">Bienvenue</h1>
  <p>Votre compte <strong>{ctx.email}</strong> est créé, mais aucune maison n'est encore partagée avec lui.</p>
  <p class="muted">Donnez cette adresse e-mail au propriétaire d'une maison : dès qu'il vous l'aura partagée,
    elle apparaîtra ici.</p>
  <div><button class="primary" onclick={refresh} disabled={busy}>{busy ? "Vérification…" : "Vérifier à nouveau"}</button></div>
</div>

<style>
  .welcome { max-width: 36rem; margin: 2rem auto; }
</style>
