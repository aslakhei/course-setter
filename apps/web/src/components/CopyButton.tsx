import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from './ui.tsx'

export function CopyButton({ text, label }: { text: string; label?: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  return (
    <Button
      size="sm"
      aria-label={label}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => setCopied(true))
      }}
    >
      <span aria-live="polite">{copied ? t('common.copied') : t('common.copy')}</span>
    </Button>
  )
}
