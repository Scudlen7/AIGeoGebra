// Protocol text is not a tool call. Never interpret or execute commands embedded in it.
export function toolMarkupStart(text: string) {
  return text.search(/<\s*[｜|]*\s*DSML\b|<\s*\/?tool_call\b/i)
}

export function assistantText(text: string, streaming = false) {
  const marker = toolMarkupStart(text)
  if (marker >= 0) return text.slice(0, marker).trimEnd() + (streaming ? '' : '\n\n模型返回了无效的工具调用，这部分操作未执行，请重试。')
  // Hold an incomplete opening tag until the next chunk identifies it.
  if (streaming) {
    const last = text.lastIndexOf('<')
    if (last >= 0 && !text.slice(last).includes('>')) return text.slice(0, last)
  }
  return text
}
