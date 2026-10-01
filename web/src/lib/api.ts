import { DemoApi } from "./demo-api";
import { SupabaseApi } from "./supabase-api";
import type { Api } from "./types";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Sans configuration Supabase, l'application démarre en mode démo. */
export const api: Api = url && key ? new SupabaseApi(url, key) : new DemoApi();
