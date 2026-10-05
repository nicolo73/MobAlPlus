<script lang="ts">
  // Message d'invitation à transmettre soi-même (WhatsApp, SMS, e-mail…) : l'application n'envoie
  // pas encore d'e-mails.

  interface Props {
    email: string;
    home: string;
    /** Droits accordés, en clair (« en lecture », « en gestion »…) */
    rights: string;
    link: string;
    onclose: () => void;
  }

  let { email, home, rights, link, onclose }: Props = $props();

  // Composant recréé à chaque invitation ({#key}) : les valeurs initiales suffisent
  // svelte-ignore state_referenced_locally
  const google = /@(gmail|googlemail)\.com$/i.test(email);
  // svelte-ignore state_referenced_locally
  let text = $state(
    `Bonjour ! Je t'invite à suivre les températures de « ${home} » sur MobAlPlus (${rights}).\n\n` +
    `1. Ouvre ${link}\n` +
    (google
      ? `2. Choisis « Continuer avec Google » avec ton compte ${email}.\n`
      : `2. Connecte-toi avec l'adresse ${email} : « Continuer avec Google » si c'est un compte Google, sinon crée ton compte avec cette adresse.\n`) +
    `\nAstuce : sur téléphone, « Ajouter à l'écran d'accueil » pour l'avoir comme une application.`,
  );
  let copied = $state(false);

  const canShare = typeof navigator !== "undefined" && "share" in navigator;
  const whatsapp = $derived(`https://wa.me/?text=${encodeURIComponent(text)}`);
  const mail = $derived(`mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(`Invitation : ${home} sur MobAlPlus`)}&body=${encodeURIComponent(text)}`);

  async function share() {
    try { await navigator.share({ title: "MobAlPlus", text }); } catch { /* annulé */ }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
      setTimeout(() => (copied = false), 2500);
    } catch { /* presse-papiers indisponible : le texte reste sélectionnable */ }
  }
</script>

<section class="card stack" aria-label="Envoyer l'invitation">
  <div class="row">
    <h2 style="margin:0">Prévenir {email}</h2>
    <span class="spacer"></span>
    <button class="link" onclick={onclose} aria-label="Fermer">Fermer</button>
  </div>
  <p class="muted" style="margin:0">L'application n'envoie pas encore d'e-mail : transmettez ce message vous-même
    (il est modifiable).</p>
  <textarea bind:value={text} rows="7" aria-label="Message d'invitation"></textarea>
  <div class="row actions">
    <a class="btn whatsapp" href={whatsapp} target="_blank" rel="noopener">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 20l1.3-3.9A8 8 0 1 1 8 18.8L4 20z" /></svg>
      WhatsApp
    </a>
    {#if canShare}<button onclick={share}>Partager…</button>{/if}
    <a class="btn" href={mail}>E-mail</a>
    <button onclick={copy}>{copied ? "Copié ✓" : "Copier le message"}</button>
  </div>
</section>

<style>
  textarea {
    font: inherit; font-size: 0.95rem; color: var(--text); background: var(--surface);
    border: 1px solid var(--border); border-radius: 8px; padding: 0.5rem 0.65rem; width: 100%; resize: vertical;
  }
  .actions { flex-wrap: wrap; gap: 0.5rem; }
  .whatsapp { border-color: #1a9e55; color: #1a9e55; font-weight: 600; }
  svg { fill: none; stroke: currentColor; stroke-width: 2; stroke-linejoin: round; }
</style>
