<script lang="ts">
  import { api } from "../lib/api";

  let email = $state("");
  let password = $state("");
  let error = $state("");
  let busy = $state(false);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = "";
    try {
      await api.signIn(email, password);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }
</script>

<div class="wrap">
  <form class="card stack" onsubmit={submit}>
    <div class="row">
      <img src="/icon.svg" alt="" width="40" height="40" />
      <h1 style="margin:0">MobAlPlus</h1>
    </div>
    <p class="muted">Connectez-vous pour consulter vos capteurs.</p>
    <label>E-mail <input type="email" autocomplete="email" required bind:value={email} /></label>
    <label>Mot de passe <input type="password" autocomplete="current-password" required bind:value={password} /></label>
    {#if error}<div class="notice err" role="alert">{error}</div>{/if}
    <button class="primary" type="submit" disabled={busy}>{busy ? "Connexion…" : "Se connecter"}</button>
  </form>
</div>

<style>
  .wrap { min-height: 100dvh; display: grid; place-items: center; padding: 1rem; }
  form { width: min(100%, 22rem); }
  input { width: 100%; }
</style>
