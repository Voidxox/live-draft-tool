// Inspira UI 组件依赖的类名合并工具:
// clsx 处理条件类名, tailwind-merge 消解 Tailwind 类冲突 (后者胜出)。
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}
