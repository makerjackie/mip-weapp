export interface CatalogSelectorOption {
  id: string
  label: string
  popular?: boolean
}

export interface CatalogSelectorGroup {
  id: string
  label: string
  options: CatalogSelectorOption[]
}
