/// <reference types="vite/client" />

interface Window {
  GGBApplet?: new (
    parameters: Record<string, unknown>,
    allowUpscale: boolean,
  ) => {
    inject: (element: HTMLElement) => void
    setHTML5Codebase?: (codebase: string) => void
  }
}
