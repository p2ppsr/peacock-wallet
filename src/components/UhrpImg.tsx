import { useEffect, useState, type ImgHTMLAttributes, type ReactNode } from 'react'
import { StorageDownloader, StorageUtils, type LookupNetworkPreset } from '@bsv/sdk'
import { ACTIVE_WALLET_ENVIRONMENT } from '../config'

type UhrpImgProps = {
  src: string
  fallback?: ReactNode
} & Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'>

const downloaders = new Map<LookupNetworkPreset, StorageDownloader>()
const resolutions = new Map<string, Promise<string | null>>()

function downloaderFor(networkPreset: LookupNetworkPreset): StorageDownloader {
  let downloader = downloaders.get(networkPreset)
  if (!downloader) {
    downloader = new StorageDownloader({ networkPreset })
    downloaders.set(networkPreset, downloader)
  }
  return downloader
}

export async function resolveUhrpImage(
  src: string,
  networkPreset: LookupNetworkPreset = ACTIVE_WALLET_ENVIRONMENT.networkPreset
): Promise<string | null> {
  if (!StorageUtils.isValidURL(src)) return src

  const cacheKey = `${networkPreset}|${src}`
  let pending = resolutions.get(cacheKey)
  if (!pending) {
    pending = downloaderFor(networkPreset)
      .resolve(src)
      .then(urls => urls[0] ?? null)
      .catch((error: unknown): null => {
        resolutions.delete(cacheKey)
        console.error(`Failed to resolve UHRP image on ${networkPreset}:`, error)
        return null
      })
    resolutions.set(cacheKey, pending)
  }
  return await pending
}

/** Resolve UHRP media through the active network's isolated overlay roots. */
export default function UhrpImg({ src, fallback, alt = '', ...props }: UhrpImgProps) {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(() =>
    StorageUtils.isValidURL(src) ? null : src
  )

  useEffect(() => {
    let cancelled = false
    setResolvedUrl(StorageUtils.isValidURL(src) ? null : src)
    void resolveUhrpImage(src).then(url => {
      if (!cancelled) setResolvedUrl(url)
    })
    return () => {
      cancelled = true
    }
  }, [src])

  return resolvedUrl ? <img src={resolvedUrl} alt={alt} {...props} /> : <>{fallback ?? null}</>
}
