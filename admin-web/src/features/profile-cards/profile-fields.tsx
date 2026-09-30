import { Button, Form, Input, Typography } from 'antd'

/** The single ordinary-profile field surface, shared by card and user editors. */
export function ProfileFields({ disabled = false }: { disabled?: boolean }) {
  return <>
        <Form.Item name="realName" label="真实姓名" rules={[{ max: 60, message: '最多输入 60 个字符' }]}><Input maxLength={60} /></Form.Item>
        <Form.Item name="nickname" label="昵称" rules={[{ required: true, whitespace: true, message: '请输入昵称' }, { max: 60, message: '最多输入 60 个字符' }]}><Input maxLength={60} /></Form.Item>
        <Form.Item name="headline" label="职位简介" rules={[{ max: 120, message: '最多输入 120 个字符' }]}><Input maxLength={120} /></Form.Item>
        <Form.Item name="introduction" label="个人介绍" rules={[{ max: 600, message: '最多输入 600 个字符' }]}><Input.TextArea rows={4} maxLength={600} showCount /></Form.Item>
        <Form.List name="companies" rules={[{ validator: async (_, value: unknown[] | undefined) => {
          if ((value?.length || 0) > 5) throw new Error('公司最多填写 5 项')
        } }]}>
          {(fields, { add, remove }, { errors }) => <section style={{ marginBottom: 24 }}>
            <Typography.Text strong>公司</Typography.Text>
            {fields.map(({ key: fieldKey, name, ...restField }) => <div key={fieldKey} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) auto', gap: 8, alignItems: 'start', marginTop: 8 }}>
              <Form.Item {...restField} name={[name, 'name']} rules={[{ required: true, whitespace: true, message: '请填写名称' }, { max: 120, message: '最多输入 120 个字符' }]} style={{ minWidth: 0, marginBottom: 0 }}><Input aria-label={`公司 ${name + 1}`} placeholder="公司名称" maxLength={120} /></Form.Item>
              <Form.Item {...restField} name={[name, 'role']} style={{ minWidth: 0, marginBottom: 0 }}><Input aria-label={`公司职务 ${name + 1}`} placeholder="职位" maxLength={120} /></Form.Item>
              <Button aria-label={`移除公司 ${name + 1}`} danger type="text" disabled={disabled} onClick={() => remove(name)}>移除</Button>
            </div>)}
            <Button style={{ marginTop: 8 }} type="dashed" onClick={() => add({ name: '', role: '' })} disabled={fields.length >= 5 || disabled}>添加公司</Button>
            <Form.ErrorList errors={errors} />
          </section>}
        </Form.List>
        <Form.List name="organizations" rules={[{ validator: async (_, value: unknown[] | undefined) => {
          if ((value?.length || 0) > 5) throw new Error('组织最多填写 5 项')
        } }]}>
          {(fields, { add, remove }, { errors }) => <section style={{ marginBottom: 24 }}>
            <Typography.Text strong>组织</Typography.Text>
            {fields.map(({ key: fieldKey, name, ...restField }) => <div key={fieldKey} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) auto', gap: 8, alignItems: 'start', marginTop: 8 }}>
              <Form.Item {...restField} name={[name, 'name']} rules={[{ required: true, whitespace: true, message: '请填写名称' }, { max: 120, message: '最多输入 120 个字符' }]} style={{ minWidth: 0, marginBottom: 0 }}><Input aria-label={`组织 ${name + 1}`} placeholder="组织名称" maxLength={120} /></Form.Item>
              <Form.Item {...restField} name={[name, 'role']} style={{ minWidth: 0, marginBottom: 0 }}><Input aria-label={`组织职务 ${name + 1}`} placeholder="职务" maxLength={120} /></Form.Item>
              <Button aria-label={`移除组织 ${name + 1}`} danger type="text" disabled={disabled} onClick={() => remove(name)}>移除</Button>
            </div>)}
            <Button style={{ marginTop: 8 }} type="dashed" onClick={() => add({ name: '', role: '' })} disabled={fields.length >= 5 || disabled}>添加组织</Button>
            <Form.ErrorList errors={errors} />
          </section>}
        </Form.List>
        <Form.Item name="identityStatus" label="职业身份" rules={[{ max: 32, message: '最多输入 32 个字符' }]}><Input maxLength={32} /></Form.Item>
  </>
}
