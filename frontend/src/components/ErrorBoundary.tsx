import { Component, type ErrorInfo, type ReactNode } from 'react'

interface State {
  failed: boolean
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Ошибка интерфейса', error, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-xl font-bold">Что-то пошло не так</h1>
        <p className="text-slate-600">Перезагрузите страницу. Если ошибка повторится — сообщите администратору.</p>
        <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
          Перезагрузить
        </button>
      </div>
    )
  }
}
