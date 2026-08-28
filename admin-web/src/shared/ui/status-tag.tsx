import { Tag } from 'antd'

const success = ['已发布', '已支付', '已结算', '启用', '玩家', '成功', '正常', '已完成']
const warning = ['报名中', '待确认', '定时中', '待支付', '支付处理中', '退款处理中', '待发布', '待审核', '处理中']
const danger = ['失败', '异常', '已拒绝', '已阻止', '已取消']
const muted = ['草稿', '嘉宾', '停用', '已撤销', '已关闭', '已结束', '已下架', '已归档']

export function StatusTag({ value }: { value: unknown }) {
  const text = String(value ?? '未知状态')
  const color = success.includes(text)
    ? 'success'
    : warning.includes(text)
      ? 'warning'
      : danger.includes(text)
        ? 'error'
        : muted.includes(text)
          ? 'default'
          : 'processing'
  return <Tag color={color}>{text}</Tag>
}
