import { afterEach, describe, expect, it, vi } from 'vitest'
import { callImageApi } from './api'

describe('callImageApi', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls /v1/responses and parses image_generation_call output', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{
        type: 'image_generation_call',
        result: 'aW1hZ2U=',
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const result = await callImageApi({
      prompt: 'test prompt',
      inputImageDataUrls: [],
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init!.body as string)
    expect(body.model).toBe('gpt-5.5')
    expect(body.input).toBe('test prompt')
    expect(body.tools[0].type).toBe('image_generation')
    expect(body.tools[0].action).toBe('generate')
    expect(result.images).toHaveLength(1)
    expect(result.images[0]).toMatch(/^data:image\/png;base64,/)
  })

  it('sends edit action when input images are provided', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{
        type: 'image_generation_call',
        result: 'aW1hZ2U=',
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const result = await callImageApi({
      prompt: 'edit prompt',
      inputImageDataUrls: ['data:image/png;base64,input'],
    })

    const [, init] = vi.mocked(fetch).mock.calls[0]
    const body = JSON.parse(init!.body as string)
    expect(body.tools[0].action).toBe('edit')
    expect(Array.isArray(body.input)).toBe(true)
    expect(result.images).toHaveLength(1)
  })
})
