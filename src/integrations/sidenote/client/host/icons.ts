import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import type { ComponentType } from 'react'

interface IconProps {
  size?: number
  className?: string
}

type IconComponent = ComponentType<IconProps>

const EmptyIcon: IconComponent = () => null
const iconExports = primitives as unknown as Readonly<Record<string, IconComponent | undefined>>

/** Prefer the weight-named 0.1.7 export, then fall back to the legacy size-named export. */
export function resolveIcon(
  exports: Readonly<Record<string, IconComponent | undefined>>,
  modernName: string,
  legacyName: string,
): IconComponent {
  return exports[modernName] ?? exports[legacyName] ?? EmptyIcon
}

const icon = (modernName: string, legacyName: string): IconComponent => resolveIcon(iconExports, modernName, legacyName)

// Keep the local legacy-shaped names so call sites only change their import source.
export const IconNewChatOutline16 = icon('IconNewChatOutlineRegular', 'IconNewChatOutline16')
export const IconCheckOutline16 = icon('IconCheckOutlineRegular', 'IconCheckOutline16')
export const IconListPenOutline16 = icon('IconListPenOutlineRegular', 'IconListPenOutline16')
export const IconEditOutline16 = icon('IconEditOutlineRegular', 'IconEditOutline16')
export const IconTrashOutline16 = icon('IconTrashOutlineRegular', 'IconTrashOutline16')
export const IconPlayOutline16 = icon('IconPlayOutlineRegular', 'IconPlayOutline16')
export const IconCordisPluginOutline14 = icon('IconCordisPluginOutlineRegular', 'IconCordisPluginOutline14')
export const IconBranchOutline16 = icon('IconBranchOutlineRegular', 'IconBranchOutline16')
export const IconShareOutline16 = icon('IconShareOutlineRegular', 'IconShareOutline16')
export const IconChevronDownOutline14 = icon('IconChevronDownOutlineRegular', 'IconChevronDownOutline14')
export const IconCloseOutline16 = icon('IconCloseOutlineRegular', 'IconCloseOutline16')
export const IconRightUpOutline16 = icon('IconRightUpOutlineRegular', 'IconRightUpOutline16')
export const IconSearchOutline16 = icon('IconSearchOutlineRegular', 'IconSearchOutline16')
export const IconGlobeOutline14 = icon('IconGlobeOutlineRegular', 'IconGlobeOutline14')
export const IconCodeOutline16 = icon('IconCodeOutlineRegular', 'IconCodeOutline16')
export const IconChecklistOutline14 = icon('IconChecklistOutlineRegular', 'IconChecklistOutline14')
export const IconThinkOutline16 = icon('IconThinkOutlineRegular', 'IconThinkOutline16')
export const IconInspectOutline12 = icon('IconInspectOutlineRegular', 'IconInspectOutline12')
export const IconPaperclipOutline16 = icon('IconPaperclipOutlineRegular', 'IconPaperclipOutline16')
export const IconStopFill16 = icon('IconStopFillRegular', 'IconStopFill16')
export const IconSendOutline16 = icon('IconSendOutlineRegular', 'IconSendOutline16')
export const IconWarningOutline16 = icon('IconWarningOutlineRegular', 'IconWarningOutline16')
export const IconQuestionOutline14 = icon('IconQuestionOutlineRegular', 'IconQuestionOutline14')
