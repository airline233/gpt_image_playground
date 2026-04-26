import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { ensureImageCached, useStore } from '../store'
import { canvasToBlob, loadImage } from '../lib/canvasImage'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'

type Tool = 'brush' | 'eraser'

interface StrokePoint {
  x: number
  y: number
}

interface CanvasSize {
  width: number
  height: number
}

function getCanvasPoint(canvas: HTMLCanvasElement, event: ReactPointerEvent<HTMLCanvasElement>): StrokePoint {
  const rect = canvas.getBoundingClientRect()
  return {
    x: ((event.clientX - rect.left) / rect.width) * canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * canvas.height,
  }
}

function fillWhiteMask(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('当前浏览器不支持 Canvas')
  ctx.globalCompositeOperation = 'source-over'
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('图片导出失败'))
    reader.readAsDataURL(blob)
  })
}

export default function MaskEditorModal() {
  const imageId = useStore((s) => s.maskEditorImageId)
  const setMaskEditorImageId = useStore((s) => s.setMaskEditorImageId)
  const inputImages = useStore((s) => s.inputImages)
  const addInputImage = useStore((s) => s.addInputImage)
  const maskDraft = useStore((s) => s.maskDraft)
  const setMaskDraft = useStore((s) => s.setMaskDraft)
  const showToast = useStore((s) => s.showToast)

  const imageCanvasRef = useRef<HTMLCanvasElement>(null)
  const previewCanvasRef = useRef<HTMLCanvasElement>(null)
  const maskCanvasRef = useRef<HTMLCanvasElement>(null)
  const activePointerIdRef = useRef<number | null>(null)
  const lastPointRef = useRef<StrokePoint | null>(null)
  const undoStackRef = useRef<ImageData[]>([])
  const redoStackRef = useRef<ImageData[]>([])
  const saveTokenRef = useRef(0)
  const sessionIdRef = useRef(0)
  const activeSessionIdRef = useRef(0)

  const [sourceDataUrl, setSourceDataUrl] = useState('')
  const [size, setSize] = useState<CanvasSize | null>(null)
  const [tool, setTool] = useState<Tool>('brush')
  const [brushSize, setBrushSize] = useState(64)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [historyState, setHistoryState] = useState({ undo: 0, redo: 0 })

  const close = () => {
    if (isSaving) return
    setMaskEditorImageId(null)
  }
  useCloseOnEscape(Boolean(imageId), close)

  function syncHistoryState() {
    setHistoryState({
      undo: undoStackRef.current.length,
      redo: redoStackRef.current.length,
    })
  }

  function renderPreview() {
    const maskCanvas = maskCanvasRef.current
    const previewCanvas = previewCanvasRef.current
    if (!maskCanvas || !previewCanvas) return

    const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true })
    const previewCtx = previewCanvas.getContext('2d')
    if (!maskCtx || !previewCtx) return

    const maskPixels = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height)
    const overlay = previewCtx.createImageData(previewCanvas.width, previewCanvas.height)

    for (let i = 0; i < maskPixels.data.length; i += 4) {
      const editStrength = 255 - maskPixels.data[i + 3]
      overlay.data[i] = 255
      overlay.data[i + 1] = 112
      overlay.data[i + 2] = 32
      overlay.data[i + 3] = Math.round(editStrength * 0.58)
    }

    previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height)
    previewCtx.putImageData(overlay, 0, 0)
  }

  function pushUndoSnapshot() {
    const canvas = maskCanvasRef.current
    const ctx = canvas?.getContext('2d', { willReadFrequently: true })
    if (!canvas || !ctx) return

    undoStackRef.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height))
    if (undoStackRef.current.length > 40) undoStackRef.current.shift()
    redoStackRef.current = []
    syncHistoryState()
  }

  function restoreMask(imageData: ImageData) {
    const canvas = maskCanvasRef.current
    const ctx = canvas?.getContext('2d', { willReadFrequently: true })
    if (!canvas || !ctx) return

    ctx.putImageData(imageData, 0, 0)
    renderPreview()
  }

  function drawAt(point: StrokePoint, nextTool = tool) {
    const canvas = maskCanvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    ctx.save()
    ctx.globalCompositeOperation = nextTool === 'brush' ? 'destination-out' : 'source-over'
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.arc(point.x, point.y, brushSize / 2, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    renderPreview()
  }

  function drawStroke(from: StrokePoint, to: StrokePoint, nextTool = tool) {
    const canvas = maskCanvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    ctx.save()
    ctx.globalCompositeOperation = nextTool === 'brush' ? 'destination-out' : 'source-over'
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = brushSize
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
    ctx.stroke()
    ctx.restore()
    renderPreview()
  }

  useEffect(() => {
    if (!imageId) {
      activeSessionIdRef.current = 0
      return
    }

    const nextSessionId = sessionIdRef.current + 1
    sessionIdRef.current = nextSessionId
    activeSessionIdRef.current = nextSessionId

    return () => {
      if (activeSessionIdRef.current === nextSessionId) {
        activeSessionIdRef.current = 0
      }
    }
  }, [imageId])

  useEffect(() => {
    if (!imageId) {
      setSourceDataUrl('')
      setSize(null)
      setIsLoading(false)
      undoStackRef.current = []
      redoStackRef.current = []
      syncHistoryState()
      return
    }

    const targetImageId = imageId
    let cancelled = false
    setIsLoading(true)
    setSourceDataUrl('')
    setSize(null)
    undoStackRef.current = []
    redoStackRef.current = []
    syncHistoryState()

    async function loadCanvases() {
      try {
        const dataUrl = await ensureImageCached(targetImageId)
        if (cancelled) return
        if (!dataUrl) {
          showToast('图片已不存在，无法编辑遮罩', 'error')
          setMaskEditorImageId(null)
          return
        }

        const image = await loadImage(dataUrl)
        if (cancelled) return

        const nextSize = { width: image.naturalWidth, height: image.naturalHeight }
        const imageCanvas = imageCanvasRef.current
        const previewCanvas = previewCanvasRef.current
        const maskCanvas = maskCanvasRef.current
        if (!imageCanvas || !previewCanvas || !maskCanvas) return

        for (const canvas of [imageCanvas, previewCanvas, maskCanvas]) {
          canvas.width = nextSize.width
          canvas.height = nextSize.height
        }

        const imageCtx = imageCanvas.getContext('2d')
        if (!imageCtx) throw new Error('当前浏览器不支持 Canvas')
        imageCtx.clearRect(0, 0, imageCanvas.width, imageCanvas.height)
        imageCtx.drawImage(image, 0, 0)

        fillWhiteMask(maskCanvas)

        if (maskDraft?.targetImageId === targetImageId) {
          try {
            const draftImage = await loadImage(maskDraft.maskDataUrl)
            if (cancelled) return
            if (draftImage.naturalWidth !== nextSize.width || draftImage.naturalHeight !== nextSize.height) {
              throw new Error('遮罩尺寸与当前图片不一致')
            }
            const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true })
            if (!maskCtx) throw new Error('当前浏览器不支持 Canvas')
            maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height)
            maskCtx.drawImage(draftImage, 0, 0)
          } catch (err) {
            fillWhiteMask(maskCanvas)
            showToast(
              `遮罩草稿加载失败，已重置为空白遮罩：${err instanceof Error ? err.message : String(err)}`,
              'error',
            )
          }
        }

        renderPreview()
        setSourceDataUrl(dataUrl)
        setSize(nextSize)
      } catch (err) {
        if (!cancelled) {
          showToast(err instanceof Error ? err.message : String(err), 'error')
          setMaskEditorImageId(null)
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void loadCanvases()

    return () => {
      cancelled = true
      activePointerIdRef.current = null
      lastPointRef.current = null
    }
  }, [imageId, maskDraft, setMaskEditorImageId, showToast])

  if (!imageId) return null

  const isReady = Boolean(sourceDataUrl && size && !isLoading)
  const canUndo = historyState.undo > 0 && isReady && !isSaving
  const canRedo = historyState.redo > 0 && isReady && !isSaving

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!isReady || isSaving || event.button !== 0) return
    event.preventDefault()
    const canvas = event.currentTarget
    activePointerIdRef.current = event.pointerId
    canvas.setPointerCapture(event.pointerId)
    pushUndoSnapshot()

    const point = getCanvasPoint(canvas, event)
    lastPointRef.current = point
    drawAt(point)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (activePointerIdRef.current !== event.pointerId || !lastPointRef.current || !isReady || isSaving) return
    event.preventDefault()
    const point = getCanvasPoint(event.currentTarget, event)
    drawStroke(lastPointRef.current, point)
    lastPointRef.current = point
  }

  const finishStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (activePointerIdRef.current !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    activePointerIdRef.current = null
    lastPointRef.current = null
  }

  const handleUndo = () => {
    const canvas = maskCanvasRef.current
    const ctx = canvas?.getContext('2d', { willReadFrequently: true })
    const previous = undoStackRef.current.pop()
    if (!canvas || !ctx || !previous) return

    redoStackRef.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height))
    restoreMask(previous)
    syncHistoryState()
  }

  const handleRedo = () => {
    const canvas = maskCanvasRef.current
    const ctx = canvas?.getContext('2d', { willReadFrequently: true })
    const next = redoStackRef.current.pop()
    if (!canvas || !ctx || !next) return

    undoStackRef.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height))
    restoreMask(next)
    syncHistoryState()
  }

  const handleClear = () => {
    const canvas = maskCanvasRef.current
    if (!canvas || !isReady || isSaving) return

    pushUndoSnapshot()
    fillWhiteMask(canvas)
    renderPreview()
  }

  const handleSave = async () => {
    const canvas = maskCanvasRef.current
    const savingSessionId = activeSessionIdRef.current
    if (!canvas || !sourceDataUrl || !isReady || isSaving || !savingSessionId) return

    const token = ++saveTokenRef.current
    const savingImageId = imageId
    try {
      setIsSaving(true)
      const blob = await canvasToBlob(canvas, 'image/png')
      const maskDataUrl = await blobToDataUrl(blob)
      if (
        saveTokenRef.current !== token ||
        activeSessionIdRef.current !== savingSessionId ||
        useStore.getState().maskEditorImageId !== savingImageId
      ) return

      if (!inputImages.some((img) => img.id === savingImageId)) {
        addInputImage({ id: savingImageId, dataUrl: sourceDataUrl })
      }
      setMaskDraft({
        targetImageId: savingImageId,
        maskDataUrl,
        updatedAt: Date.now(),
      })
      setMaskEditorImageId(null)
      showToast('遮罩已保存', 'success')
    } catch (err) {
      if (
        saveTokenRef.current !== token ||
        activeSessionIdRef.current !== savingSessionId ||
        useStore.getState().maskEditorImageId !== savingImageId
      ) return
      showToast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      if (saveTokenRef.current === token) setIsSaving(false)
    }
  }

  const toolButtonClass = (active: boolean) =>
    `flex-1 rounded-xl px-3 py-2 text-sm font-medium transition ${
      active
        ? 'bg-orange-500 text-white shadow-sm shadow-orange-500/20'
        : 'bg-white/60 text-gray-600 hover:bg-white dark:bg-white/[0.04] dark:text-gray-300 dark:hover:bg-white/[0.08]'
    }`

  const actionButtonClass =
    'rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 text-sm text-gray-600 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-45 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-300 dark:hover:bg-white/[0.08]'

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-md animate-overlay-in" onClick={close} />
      <div
        className="relative z-10 flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-white/50 bg-white/95 shadow-2xl ring-1 ring-black/5 animate-modal-in dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mask-editor-title"
      >
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-4 py-3 dark:border-white/[0.08] sm:px-5">
          <div>
            <h3 id="mask-editor-title" className="text-base font-semibold text-gray-800 dark:text-gray-100">编辑遮罩</h3>
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              橙色区域将被编辑；未涂抹区域保持白色保护。
            </p>
          </div>
          <button
            onClick={close}
            className="rounded-full p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
            aria-label="关闭"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 lg:flex-row lg:p-5">
          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-3xl border border-gray-200/70 bg-[radial-gradient(circle_at_20%_20%,rgba(249,115,22,0.12),transparent_26%),linear-gradient(135deg,rgba(15,23,42,0.06),rgba(255,255,255,0.72))] p-3 dark:border-white/[0.08] dark:bg-[radial-gradient(circle_at_20%_20%,rgba(249,115,22,0.16),transparent_28%),linear-gradient(135deg,rgba(255,255,255,0.05),rgba(0,0,0,0.28))]">
            {isLoading && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/50 text-sm text-gray-500 backdrop-blur-sm dark:bg-gray-900/50 dark:text-gray-300">
                正在载入图片...
              </div>
            )}
            <div
              className="relative max-h-full max-w-full overflow-hidden rounded-2xl bg-gray-950/5 shadow-[0_20px_60px_rgba(15,23,42,0.18)] ring-1 ring-black/10 dark:bg-black/30 dark:ring-white/10"
              style={{
                aspectRatio: size ? `${size.width} / ${size.height}` : '1 / 1',
                width: size ? 'min(100%, calc((92vh - 12rem) * var(--mask-aspect)))' : 'min(100%, 520px)',
                maxHeight: '100%',
                ['--mask-aspect' as string]: size ? String(size.width / size.height) : '1',
              }}
            >
              <canvas ref={imageCanvasRef} className="absolute inset-0 h-full w-full" />
              <canvas ref={previewCanvasRef} className="absolute inset-0 h-full w-full pointer-events-none" />
              <canvas
                ref={maskCanvasRef}
                className="absolute inset-0 h-full w-full touch-none opacity-0"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={finishStroke}
                onPointerCancel={finishStroke}
                onLostPointerCapture={finishStroke}
              />
            </div>
          </div>

          <aside className="w-full rounded-3xl border border-gray-200/70 bg-white/70 p-4 dark:border-white/[0.08] dark:bg-white/[0.03] lg:w-72">
            <div className="space-y-5">
              <section>
                <div className="mb-2 text-xs font-medium text-gray-400 dark:text-gray-500">工具</div>
                <div className="flex rounded-2xl bg-gray-100/80 p-1 dark:bg-black/20">
                  <button className={toolButtonClass(tool === 'brush')} onClick={() => setTool('brush')} disabled={!isReady || isSaving}>
                    画笔
                  </button>
                  <button className={toolButtonClass(tool === 'eraser')} onClick={() => setTool('eraser')} disabled={!isReady || isSaving}>
                    橡皮
                  </button>
                </div>
                <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
                  画笔创建透明编辑区，橡皮恢复白色保护区。
                </p>
              </section>

              <section>
                <div className="mb-2 flex items-center justify-between text-xs font-medium text-gray-400 dark:text-gray-500">
                  <span>笔刷大小</span>
                  <span className="font-mono text-gray-500 dark:text-gray-300">{brushSize}px</span>
                </div>
                <input
                  type="range"
                  min={8}
                  max={220}
                  value={brushSize}
                  onChange={(e) => setBrushSize(Number(e.target.value))}
                  className="w-full accent-orange-500"
                  disabled={!isReady || isSaving}
                />
              </section>

              <section>
                <div className="mb-2 text-xs font-medium text-gray-400 dark:text-gray-500">历史</div>
                <div className="grid grid-cols-3 gap-2">
                  <button onClick={handleUndo} disabled={!canUndo} className={actionButtonClass}>
                    撤销
                  </button>
                  <button onClick={handleRedo} disabled={!canRedo} className={actionButtonClass}>
                    重做
                  </button>
                  <button onClick={handleClear} disabled={!isReady || isSaving} className={actionButtonClass}>
                    清空
                  </button>
                </div>
              </section>

              <section className="rounded-2xl bg-orange-50/80 p-3 text-xs leading-relaxed text-orange-700 dark:bg-orange-500/10 dark:text-orange-200">
                保存后会把当前图片加入参考图，并在提交时作为遮罩主图使用。
              </section>
            </div>
          </aside>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-gray-100 px-4 py-3 dark:border-white/[0.08] sm:flex-row sm:justify-end sm:px-5">
          <button
            onClick={close}
            disabled={isSaving}
            className="rounded-xl border border-gray-200/70 bg-white/70 px-4 py-2 text-sm text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-45 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-300 dark:hover:bg-white/[0.08]"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={!isReady || isSaving}
            className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-medium text-white shadow-sm shadow-orange-500/20 transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:shadow-none dark:disabled:bg-white/[0.08]"
          >
            {isSaving ? '保存中...' : '保存遮罩'}
          </button>
        </div>
      </div>
    </div>
  )
}
