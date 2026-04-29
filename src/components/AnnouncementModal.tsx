import { useEffect, useState } from 'react'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'

const ANNOUNCEMENT = import.meta.env.VITE_ANNOUNCEMENT?.trim() || ''
const STORAGE_KEY = 'announcement-dismissed'

function getDismissedVersion(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

function setDismissedVersion(v: string) {
  try {
    localStorage.setItem(STORAGE_KEY, v)
  } catch {
    /* ignore */
  }
}

export default function AnnouncementModal() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!ANNOUNCEMENT) return
    if (getDismissedVersion() === ANNOUNCEMENT) return
    setOpen(true)
  }, [])

  useCloseOnEscape(open, () => setOpen(false))

  const dismiss = () => {
    setDismissedVersion(ANNOUNCEMENT)
    setOpen(false)
  }

  if (!open || !ANNOUNCEMENT) return null

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm animate-overlay-in"
        onClick={dismiss}
      />
      <div className="relative z-10 w-full max-w-lg rounded-3xl border border-white/50 bg-white/95 p-6 shadow-2xl ring-1 ring-black/5 animate-modal-in dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10">
        <div className="flex items-start gap-3 mb-4">
          <div className="flex-shrink-0 w-9 h-9 rounded-full bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center">
            <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100">
              公告
            </h3>
          </div>
          <button
            onClick={dismiss}
            className="flex-shrink-0 rounded-full p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
            aria-label="关闭"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div 
          className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed whitespace-pre-wrap mb-6"
          dangerouslySetInnerHTML={{ __html: ANNOUNCEMENT }}
        />

        <div className="flex justify-end">
          <button
            onClick={dismiss}
            className="px-5 py-2 rounded-xl bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 transition-colors shadow-sm"
          >
            知道了
          </button>
        </div>
      </div>
    </div>
  )
}
