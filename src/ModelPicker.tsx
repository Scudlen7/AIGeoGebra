import { For, Show, createEffect, createMemo, createSignal, createUniqueId, onCleanup } from 'solid-js'
import type { PublicModel } from './api'
import { Icon } from './Icon'

type Option = { id: string; model: PublicModel; label: string; modelId: string }
type Group = { name: string; options: Option[] }

export function ModelPicker(props: {
  models: PublicModel[]
  selected?: PublicModel
  disabled: boolean
  saving: boolean
  onSelect: (id: string) => void
}) {
  const [open, setOpen] = createSignal(false)
  const [query, setQuery] = createSignal('')
  const [activeId, setActiveId] = createSignal<string>()
  const panelId = `model-picker-${createUniqueId()}`
  const listId = `${panelId}-options`
  let root!: HTMLDivElement
  let trigger!: HTMLButtonElement
  let search: HTMLInputElement | undefined
  let list: HTMLDivElement | undefined

  const groups = createMemo(() => {
    const byProvider = new Map<string, Group>()
    for (const [index, model] of props.models.entries()) {
      const providerId = model.connection?.providerId ?? ''
      let group = byProvider.get(providerId)
      if (!group) {
        group = { name: providerId ? model.providerName || '个人供应商' : '平台试用', options: [] }
        byProvider.set(providerId, group)
      }
      group.options.push({
        id: `${listId}-${index}`,
        model,
        label: model.modelLabel ?? model.label,
        modelId: model.connection?.modelId ?? model.id,
      })
    }
    return [...byProvider.values()]
  })
  const visibleGroups = createMemo(() => {
    const terms = query().trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (!terms.length) return groups()
    return groups().map((group) => ({
      name: group.name,
      options: group.options.filter((item) => {
        const text = `${group.name} ${item.label} ${item.modelId}`.toLowerCase()
        return terms.every((term) => text.includes(term))
      }),
    })).filter((group) => group.options.length)
  })
  const options = createMemo(() => visibleGroups().flatMap((group) => group.options))
  const active = createMemo(() => options().find((item) => item.model.id === activeId()) ?? options()[0])
  const label = () => props.saving ? '正在切换…' : props.selected?.label || '选择模型'

  function close(restoreFocus = false) {
    setOpen(false)
    if (restoreFocus) trigger.focus()
  }

  function revealActive() {
    const id = active()?.id
    if (id) document.getElementById(id)?.scrollIntoView({ block: 'nearest' })
  }

  function toggle() {
    if (props.disabled) return
    if (open()) {
      close(true)
      return
    }
    setQuery('')
    setActiveId(props.selected?.id)
    setOpen(true)
    queueMicrotask(() => {
      if (!open()) return
      search?.focus()
      revealActive()
    })
  }

  function select(item: Option | undefined) {
    if (!item || props.disabled) return
    close(true)
    props.onSelect(item.model.id)
  }

  function navigate(event: KeyboardEvent) {
    if (event.isComposing || !['Escape', 'Enter', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Escape') close(true)
    else if (event.key === 'Enter') select(active())
    else {
      const items = options()
      const index = items.findIndex((item) => item === active())
      const offset = event.key === 'ArrowDown' ? 1 : -1
      const next = items[Math.max(0, Math.min(items.length - 1, index + offset))]
      if (next) {
        setActiveId(next.model.id)
        revealActive()
      }
    }
  }

  createEffect(() => {
    if (!open()) return
    if (props.disabled) {
      close(true)
      return
    }
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.contains(event.target)) close()
    }
    document.addEventListener('pointerdown', outside)
    onCleanup(() => document.removeEventListener('pointerdown', outside))
  })

  return (
    <div class="model-switch" ref={root} on:focusout={(event) => {
      if (open() && event.relatedTarget instanceof Node && !root.contains(event.relatedTarget)) close()
    }}>
      <span>当前模型</span>
      <button class="model-switch-trigger" ref={trigger} type="button" aria-label={`当前模型 ${label()}`}
        aria-expanded={open()} aria-controls={open() ? panelId : undefined} aria-disabled={props.disabled}
        title={label()} onClick={toggle}>
        <span>{label()}</span>
        <Icon name="caret-down" />
      </button>
      <Show when={open()}>
        <div id={panelId} class="model-picker-panel">
          <input ref={search} type="search" role="combobox" aria-label="搜索模型" aria-controls={listId}
            aria-expanded="true" aria-autocomplete="list" aria-activedescendant={active()?.id}
            placeholder="搜索模型、ID 或供应商" autocomplete="off" value={query()}
            onInput={(event) => {
              setActiveId(undefined)
              setQuery(event.currentTarget.value)
              if (list) list.scrollTop = 0
            }} on:keydown={navigate} />
          <div ref={list} id={listId} class="model-picker-list" role="listbox" aria-label="可用模型">
            <For each={visibleGroups()}>{(group) => (
              <div class="model-picker-group" role="group" aria-label={group.name}>
                <p aria-hidden="true">{group.name}</p>
                <For each={group.options}>{(item) => (
                  <div class="model-picker-option" id={item.id} role="option" aria-selected={props.selected?.id === item.model.id}
                    data-active={active()?.id === item.id} onMouseMove={() => setActiveId(item.model.id)}
                    onMouseDown={(event) => event.preventDefault()} onClick={() => select(item)}>
                    <div>
                      <span>{item.label}</span>
                      <Show when={item.label !== item.modelId}><small>{item.modelId}</small></Show>
                    </div>
                    <Show when={props.selected?.id === item.model.id}><span class="model-picker-check" aria-hidden="true">✓</span></Show>
                  </div>
                )}</For>
              </div>
            )}</For>
          </div>
          <Show when={!options().length}><p class="model-picker-empty" role="status">未找到匹配的模型</p></Show>
        </div>
      </Show>
    </div>
  )
}
