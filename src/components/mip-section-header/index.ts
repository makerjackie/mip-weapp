/** SectionHeader — brand glyph, 16px title, optional right meta. */
Component({
  options: {
    virtualHost: false,
  },
  properties: {
    icon: { type: String, value: '' },
    title: { type: String, value: '' },
    extra: { type: String, value: '' },
  },
})
