<script lang="ts">
  import { api } from "../lib/api";

  let email = $state("");
  let password = $state("");
  let error = $state("");
  let busy = $state(false);
  // Bouton Google affiché seulement si le fournisseur est activé dans Supabase (variable de build)
  const google = import.meta.env.VITE_AUTH_GOOGLE === "true";

  async function withGoogle() {
    error = "";
    try {
      await api.signInWithGoogle();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

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
    {#if google}
      <button type="button" class="google" onclick={withGoogle}>
        <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true">
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/>
          <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/>
        </svg>
        Continuer avec Google
      </button>
      <div class="sep"><span>ou</span></div>
    {/if}
    <label>E-mail <input type="email" autocomplete="email" required bind:value={email} /></label>
    <label>Mot de passe <input type="password" autocomplete="current-password" required bind:value={password} /></label>
    {#if error}<div class="notice err" role="alert">{error}</div>{/if}
    <button class="primary" type="submit" disabled={busy}>{busy ? "Connexion…" : "Se connecter"}</button>
  </form>
</div>

<style>
  .google { justify-content: center; font-weight: 600; }
  .sep { display: flex; align-items: center; gap: 0.75rem; color: var(--muted); font-size: 0.85rem; }
  .sep::before, .sep::after { content: ""; flex: 1; border-top: 1px solid var(--border); }
  .wrap { min-height: 100dvh; display: grid; place-items: center; padding: 1rem; }
  form { width: min(100%, 22rem); }
  input { width: 100%; }
</style>
