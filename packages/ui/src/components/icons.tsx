import type { StepKind } from "../types";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  Alert02Icon,
  ArrowRight01Icon,
  BrainIcon,
  Cancel01Icon,
  CommandLineIcon,
  CursorPointer02Icon,
  Loading03Icon,
  PauseIcon as HugePauseIcon,
  PencilEdit02Icon,
  PlayIcon as HugePlayIcon,
  RefreshIcon,
  Search01Icon,
  SparklesIcon,
  StarIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";

const STEP_ICON: Record<StepKind, IconSvgElement> = {
  thinking: BrainIcon,
  tool_call: Search01Icon,
  edit: PencilEdit02Icon,
  command: CommandLineIcon,
  assistant: SparklesIcon,
  grading: StarIcon,
};

export function UiIcon({
  icon,
  size = 14,
  strokeWidth = 1.7,
  className,
}: {
  icon: IconSvgElement;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  return <HugeiconsIcon className={className} icon={icon} size={size} color="currentColor" strokeWidth={strokeWidth} />;
}

export function StepIcon({ kind }: { kind: StepKind }) {
  return <UiIcon icon={STEP_ICON[kind]} size={12} strokeWidth={1.8} />;
}

export const PlayIcon = () => <UiIcon icon={HugePlayIcon} size={13} strokeWidth={1.8} />;
export const PauseIcon = () => <UiIcon icon={HugePauseIcon} size={13} strokeWidth={1.8} />;
export const RestartIcon = () => <UiIcon icon={RefreshIcon} size={13} strokeWidth={1.8} />;
export const CloseIcon = () => <UiIcon icon={Cancel01Icon} size={14} strokeWidth={1.8} />;
export const BrandIcon = () => <UiIcon icon={CursorPointer02Icon} size={14} strokeWidth={1.8} />;
export const EditIcon = () => <UiIcon icon={PencilEdit02Icon} size={13} strokeWidth={1.8} />;
export const ArrowRightIcon = () => <UiIcon icon={ArrowRight01Icon} size={12} strokeWidth={1.8} />;
export const AlertIcon = () => <UiIcon icon={Alert02Icon} size={12} strokeWidth={1.8} />;
export const PassIcon = () => <UiIcon icon={Tick02Icon} size={13} strokeWidth={1.9} />;
export const FailIcon = () => <UiIcon icon={Cancel01Icon} size={13} strokeWidth={1.9} />;
export const LoadingIcon = () => <UiIcon icon={Loading03Icon} size={13} strokeWidth={1.8} />;
