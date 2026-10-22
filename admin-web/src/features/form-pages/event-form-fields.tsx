import { Typography, type FormInstance } from 'antd'
import type { OperationField, OperationValues } from '../../modules/admin-operation-ui'
import { OperationFields } from '../../shared/ui/operation-fields'
import './event-form-fields.css'

const groups = [
  { title: '基本信息', fields: ['title', 'coverAssetId', 'scopeType', 'branchId', 'tagIds'] },
  { title: '时间、地点与费用', fields: ['accessType', 'priceCents', 'memberFree', 'eventMode', 'startsAt', 'endsAt', 'venueName', 'guideUrl', 'address', 'cityName', 'onlineUrl'] },
  { title: '图文内容', fields: ['description', 'organizerIntroduction', 'notices'] },
]

/** Layout only: the original field definitions, names, validation and values stay authoritative. */
export function EventFormFields({ fields, form }: { fields: readonly OperationField[]; form: FormInstance<OperationValues> }) {
  const grouped = new Set(groups.flatMap(group => group.fields))
  return <>
    {groups.map(group => <section className="event-form-section mutation-field--wide" key={group.title} aria-label={group.title}>
      <Typography.Title level={4}>{group.title}</Typography.Title>
      <div className="mutation-grid">
        <OperationFields form={form} fields={group.fields.flatMap(key => {
          const field = fields.find(item => (item.key || item.name) === key)
          return field ? [{ ...field, ...(key === 'title' || key === 'coverAssetId' ? { wide: false } : {}) }] : []
        })} />
      </div>
    </section>)}
    <OperationFields fields={fields.filter(field => !grouped.has(String(field.key || field.name)))} form={form} />
  </>
}
