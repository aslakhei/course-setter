interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** Font files imported as URLs (Vite `?url`), from packages/core/fonts. */
declare module '*.ttf?url' {
  const url: string
  export default url
}
