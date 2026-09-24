/** 侧栏 ActionModal 桥：供 sendEdition.pro / Pro 升级等打开通用弹窗（无内置「升级 Pro」默认） */

export type ChatActionModalOptions = {
  title: string;
  buttonText: string;
  onAction?: () => void;
  /** 可选大号邀请码展示（如会员到期） */
  inviteCode?: string;
  inviteLabel?: string;
};

type Opener = (opts: ChatActionModalOptions) => void;

let opener: Opener | null = null;

export function setChatActionModalOpener(fn: Opener | null): void {
  opener = fn;
}

export function openChatActionModal(opts: ChatActionModalOptions): void {
  opener?.(opts);
}
