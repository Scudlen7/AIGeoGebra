import DOMPurify from 'dompurify'
import { Marked } from 'marked'
import markedKatex from 'marked-katex-extension'
import 'katex/dist/katex.min.css'

const marked = new Marked()
marked.use(
  markedKatex({
    throwOnError: false,
    nonStandard: true,
  }),
)

export function renderMarkdown(source: string) {
  const html = marked.parse(source, { async: false })
  return DOMPurify.sanitize(html)
}

if (import.meta.env.DEV) {
  Object.assign(window, { __renderMarkdown: renderMarkdown })
}
