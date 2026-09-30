import toast from 'react-hot-toast'

// Одинаковые сообщения в течение 2 секунд не дублируются (например, при
// пачке неудачных загрузок фото).
const recent = new Map<string, number>()

function fresh(msg: string): boolean {
  const now = Date.now()
  const last = recent.get(msg)
  if (last && now - last < 2000) return false
  recent.set(msg, now)
  return true
}

export const notify = {
  success: (msg: string) => {
    if (fresh(msg)) toast.success(msg, { duration: 3000 })
  },
  error: (msg: string) => {
    if (fresh(msg)) toast.error(msg, { duration: 5000 })
  },
}
