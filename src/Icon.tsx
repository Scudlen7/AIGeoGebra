export function Icon(props: { name: string }) {
  return <span class="icon" aria-hidden="true" style={{ 'mask-image': `url(/design/${props.name}.svg)`, '-webkit-mask-image': `url(/design/${props.name}.svg)` }} />
}
