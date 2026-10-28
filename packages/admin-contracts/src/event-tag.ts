/** Fixed activity-tag palette shared by the two presentation adapters. */
export const EVENT_TAG_BACKGROUNDS = [
  { value: '#7acbff', label: '蓝色' },
  { value: '#fcdf03', label: '黄色' },
  { value: '#18e779', label: '绿色' },
  { value: '#ff4d5e', label: '红色' },
] as const
export const EVENT_TAG_TEXT_COLORS = [
  { value: '#000000', label: '黑色' },
  { value: '#ffffff', label: '白色' },
] as const
export interface EventTagStyle { name: string, backgroundColor: string, textColor: string }
export function eventTagStyle(name: string, style?: Partial<EventTagStyle>): EventTagStyle {
  return {
    name,
    backgroundColor: EVENT_TAG_BACKGROUNDS.some(item => item.value === style?.backgroundColor) ? style!.backgroundColor! : EVENT_TAG_BACKGROUNDS[0].value,
    textColor: EVENT_TAG_TEXT_COLORS.some(item => item.value === style?.textColor) ? style!.textColor! : EVENT_TAG_TEXT_COLORS[0].value,
  }
}
export function eventTagStyles(names: string[], styles: EventTagStyle[] = []): EventTagStyle[] {
  return [...new Set(names.map(name => name.trim()).filter(Boolean))].map(name => eventTagStyle(name, styles.find(style => style.name === name)))
}
