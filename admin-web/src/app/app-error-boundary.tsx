import { Alert, Button } from 'antd'
import { Component, type ErrorInfo, type ReactNode } from 'react'

interface State { error: Error | null }

export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State { return { error } }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('MIP admin React boundary', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <main className="fatal-state">
        <Alert
          type="error"
          showIcon
          title="页面暂时无法显示"
          description="界面运行时发生错误。刷新后仍未恢复时，请记录当前页面和操作。"
          action={<Button onClick={() => window.location.reload()}>刷新页面</Button>}
        />
      </main>
    )
  }
}
