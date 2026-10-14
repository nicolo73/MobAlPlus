<script lang="ts">
  // Volet repliable : carte dont l'en-tête (titre, résumé, actions) reste visible, le contenu se
  // déplie au toucher. État mémorisé par `key` (lib/panels).
  import type { Snippet } from "svelte";
  import { isOpen, setOpen } from "../lib/panels.svelte";

  interface Props {
    key: string;
    title: string;
    /** Précision discrète après le titre, ex. « (°C) » */
    sub?: string;
    /** Ouvert par défaut (tant que l'utilisateur n'a rien choisi) */
    defaultOpen?: boolean;
    /** Ancre, pour y aller depuis un autre volet */
    id?: string;
    /** Résumé dans l'en-tête (valeur actuelle, pastilles d'état…), visible même replié */
    summary?: Snippet;
    /** Boutons ou liens à droite de l'en-tête */
    actions?: Snippet;
    children: Snippet;
    class?: string;
    style?: string;
  }
  let { key, title, sub, defaultOpen = true, id, summary, actions, children, class: cls = "", style = "" }: Props = $props();

  const open = $derived(isOpen(key, defaultOpen));
</script>

<section class="card panel {cls}" class:closed={!open} {id} {style}>
  <div class="ph">
    <button class="toggle" onclick={() => setOpen(key, !open)} aria-expanded={open}>
      <span class="chev" aria-hidden="true">{open ? "▾" : "▸"}</span>
      <h2>{title}{#if sub}<small class="muted">{sub}</small>{/if}</h2>
      {#if summary}<span class="summary">{@render summary()}</span>{/if}
    </button>
    {#if actions}<span class="actions">{@render actions()}</span>{/if}
  </div>
  {#if open}<div class="pb">{@render children()}</div>{/if}
</section>

<style>
  .panel { display: flex; flex-direction: column; }
  .panel.closed { padding-top: 0.55rem; padding-bottom: 0.55rem; }
  .ph { display: flex; align-items: center; gap: 0.5rem; }
  .toggle { flex: 1; min-width: 0; display: flex; align-items: center; gap: 0.5rem 0.6rem; flex-wrap: wrap; border: none;
            background: none; padding: 0; text-align: left; color: inherit; min-height: 2.2rem; }
  .toggle:hover h2 { color: var(--primary); }
  .chev { color: var(--muted); width: 0.8rem; flex: none; }
  h2 { margin: 0; font-size: 1.1rem; }
  h2 small { font-weight: 400; margin-left: 0.35em; }
  .summary { display: inline-flex; align-items: center; gap: 0.3rem; flex-wrap: wrap; font-size: 0.9rem; }
  .actions { flex: none; display: inline-flex; align-items: center; gap: 0.4rem; }
  .pb { margin-top: 0.6rem; display: flex; flex-direction: column; gap: 0.6rem; min-width: 0; }
</style>
