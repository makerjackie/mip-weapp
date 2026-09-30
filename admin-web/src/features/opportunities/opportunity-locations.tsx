import { Checkbox, Space } from 'antd'
import { RemoteCatalogSelect } from '../../shared/ui/session-user-select'
type Location = { type: 'CITY' | 'NATIONAL' | 'REMOTE'; cityTagId?: string }
export function OpportunityLocations({ value = [], onChange }: { value?: Location[]; onChange?: (value: Location[]) => void }) {
  const cities = value.filter(item => item.type === 'CITY').map(item => item.cityTagId || '').filter(Boolean)
  const general = value.filter(item => item.type !== 'CITY').map(item => item.type)
  return <Space orientation="vertical" style={{ width: '100%' }}>
    <RemoteCatalogSelect action="mip.admin.opportunities.options" optionsKey="cities" multiple value={cities} placeholder="选择合作城市" onChange={ids => onChange?.([...(Array.isArray(ids) ? ids : []).map(cityTagId => ({ type: 'CITY' as const, cityTagId })), ...value.filter(item => item.type !== 'CITY')])} />
    <Checkbox.Group value={general} options={[{ value: 'NATIONAL', label: '全国' }, { value: 'REMOTE', label: '远程' }]} onChange={types => onChange?.([...value.filter(item => item.type === 'CITY'), ...types.filter((type): type is 'NATIONAL' | 'REMOTE' => type === 'NATIONAL' || type === 'REMOTE').map(type => ({ type }))])} />
  </Space>
}
