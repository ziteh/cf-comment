import DOMPurify, { type Config as dompurifyConfig } from 'dompurify';
import snarkdown from 'snarkdown';
import { html, render, type TemplateResult } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import type { Comment } from '@wonton-comment/shared';
import { createApiService } from './apiService';
import { createI18n } from './i18n';
import './index.css';

export function initWontonComment(elementId: string = 'wtc-app', options = {}) {
  const wontonApp = new WontonComment(elementId, options);
  wontonApp.renderApp();
  return wontonApp;
}

class WontonComment {
  private elementId: string;
  private post: string;
  private apiUrl: string;
  private apiService: ReturnType<typeof createApiService>;
  private i18n: ReturnType<typeof createI18n>;
  private commentMap: CommentMap = {};
  private comments: Comment[] = [];
  private currentReplyTo: string | null = null;
  private previewText: string = '';
  private editingComment: Comment | null = null;
  private activeTab: 'write' | 'preview' = 'write';
  private showMarkdownHelp: boolean = false;

  constructor(
    elementId: string,
    options: {
      post?: string;
      apiUrl?: string;
    } = {},
  ) {
    this.elementId = elementId;
    this.post = options.post || '/blog/my-post';
    this.apiUrl = options.apiUrl || 'http://localhost:8787/';
    this.apiService = createApiService(this.apiUrl);
    this.i18n = createI18n();

    this.setupDOMPurify();
  }

  private setupDOMPurify() {
    DOMPurify.addHook('afterSanitizeAttributes', (node) => {
      // window.opener
      if (node.tagName === 'A') {
        node.setAttribute('rel', 'noopener noreferrer');
        node.setAttribute('target', '_blank');
      }

      // Add loading lazy attribute
      if (node.tagName === 'IMG') {
        node.setAttribute('loading', 'lazy');
      }
    });

    // Only http:// or https://
    DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
      if (data.attrName === 'href' || data.attrName === 'src') {
        try {
          const url = new URL(data.attrValue || ''); // Disregard the relative path
          if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            data.keepAttr = false; // Remove the attribute entirely
          }
        } catch (_err) {
          data.keepAttr = false; // Remove the attribute entirely
        }
      }
    });
  }

  private DompurifyConfig: dompurifyConfig = {
    ALLOWED_TAGS: [
      'a',
      'b',
      'i',
      'em',
      'strong',
      's',
      'p',
      'ul',
      'ol',
      'li',
      'code',
      'pre',
      'blockquote',
      'h6', // only H6
      'hr',
      'br',
      'img',
    ],
    ALLOWED_ATTR: ['href', 'src', 'alt'],
    ALLOW_DATA_ATTR: false, // data-*
    ALLOW_ARIA_ATTR: false, // aria-*

    // explicitly blocklist
    // FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'form', 'embed'],
    // FORBID_ATTR: ['style', 'onclick', 'onmouseover', 'onload', 'onunload', 'onerror'],
  };

  private canEditComment(commentId: string): boolean {
    return this.apiService.canEditComment(commentId);
  }

  private renderMarkdown(md: string): ReturnType<typeof unsafeHTML> {
    return unsafeHTML(DOMPurify.sanitize(snarkdown(md || ''), this.DompurifyConfig));
  }

  private formatDate(timestamp: number): string {
    const date = new Date(timestamp);

    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');

    let hour = date.getHours();
    const minute = String(date.getMinutes()).padStart(2, '0');
    const period = hour >= 12 ? 'PM' : 'AM';

    hour = hour % 12;
    if (hour === 0) hour = 12; // 0 => 12 AM or 12 PM
    const h = String(hour).padStart(2, '0');

    return `${y}/${m}/${d} ${h}:${minute} ${period}`;
  }

  private getDisplayName(comment: Comment | undefined): string {
    return comment?.name || this.i18n.t('anonymous');
  }

  private renderForm() {
    const formTemplate = this.createFormTemplate();
    const formElement = document.getElementById('comment-form-container');
    if (formElement) {
      render(formTemplate, formElement);
    }
  }

  private renderPreview() {
    const now = Date.now();
    const nameInput = document.querySelector(
      '#comment-form input[name="name"]',
    ) as HTMLInputElement;
    const userName = nameInput ? nameInput.value : '';

    const previewTemplate = html`
      <div id="preview" class="${this.activeTab === 'preview' ? 'active' : ''}">
        ${this.previewText
          ? html`
              <div class="preview-comment">
                <div class="comment-header">
                  <span class="comment-name">${userName || this.i18n.t('anonymous')}</span>
                  <span class="comment-time">${this.formatDate(now)}</span>
                  ${this.currentReplyTo && this.commentMap[this.currentReplyTo]
                    ? html`<span class="reply-to">
                        ${this.i18n.t('replyTo')}
                        <span>${this.getDisplayName(this.commentMap[this.currentReplyTo])}</span>
                      </span>`
                    : ''}
                </div>
                <div class="comment-content">${this.renderMarkdown(this.previewText)}</div>
              </div>
            `
          : html`<div class="empty-preview">${this.i18n.t('emptyPreview')}</div>`}
      </div>
    `;
    const previewElement = document.getElementById('preview-container');
    if (previewElement) {
      render(
        previewElement.classList.contains('active') ? previewTemplate : html``,
        previewElement,
      );
    }
  }

  private switchTab(tab: 'write' | 'preview') {
    this.activeTab = tab;

    const writeTab = document.getElementById('write-tab');
    const previewTab = document.getElementById('preview-tab');
    const formContainer = document.getElementById('form-content');
    const previewContainer = document.getElementById('preview-container');

    if (writeTab && previewTab) {
      writeTab.classList.toggle('active', tab === 'write');
      previewTab.classList.toggle('active', tab === 'preview');
    }

    if (formContainer && previewContainer) {
      formContainer.classList.toggle('active', tab === 'write');
      previewContainer.classList.toggle('active', tab === 'preview');

      if (tab === 'preview') {
        this.renderPreview();
      }
    }
  }

  private async renderCommentsList() {
    if (this.comments.length === 0) {
      this.comments = await this.loadComments();
      this.commentMap = {};
      this.comments.forEach((comment) => {
        this.commentMap[comment.id] = comment;
      });
    }

    const commentsTemplate = html`
      <div id="comments">${this.processComments(this.comments)}</div>
    `;

    const commentsElement = document.getElementById('comments-container');
    if (commentsElement) {
      render(commentsTemplate, commentsElement);
    }
  }

  private setReplyTo(commentId: string): void {
    this.currentReplyTo = commentId;
    this.renderForm();

    const form = document.querySelector('#comment-form-container');
    if (form) {
      form.scrollIntoView({ behavior: 'smooth' });
    }
  }

  private cancelReply(): void {
    this.currentReplyTo = null;
    this.renderForm();
  }

  private handleInputChange(e: Event): void {
    const target = e.target as HTMLInputElement;
    this.previewText = target.value;

    if (this.activeTab === 'preview') {
      this.renderPreview();
    }
  }

  private async loadComments(): Promise<Comment[]> {
    return await this.apiService.getComments(this.post);
  }

  private createCommentItemTemplate(
    comment: Comment,
    isRoot: boolean = false,
    replyToName: string | null = null,
    allReplies: Comment[] | null = null,
    commentMap: CommentMap | null = null,
  ): TemplateResult<1> {
    const className = isRoot ? 'comment' : 'reply';
    const headerClass = isRoot ? 'comment-header' : 'reply-header';
    const nameClass = isRoot ? 'comment-name' : 'reply-name';
    const timeClass = isRoot ? 'comment-time' : 'reply-time';
    const contentClass = isRoot ? 'comment-content' : 'reply-content';
    const canEdit = this.canEditComment(comment.id);

    return html`
      <div class="${className}" ${isRoot ? `data-id="${comment.id}"` : ''}>
        <div class="${headerClass}">
          <span class="${nameClass}" title="${comment.id}">${this.getDisplayName(comment)}</span>
          <span
            class="${timeClass}"
            title="${comment.modDate ? this.formatDate(comment.pubDate) : undefined}"
          >
            ${comment.modDate
              ? this.i18n.t('modified') + ' ' + this.formatDate(comment.modDate)
              : this.formatDate(comment.pubDate)}
          </span>
          ${replyToName
            ? html`<span class="reply-to"
                >${this.i18n.t('replyTo')}
                <span title="${comment.replyTo ?? ''}">${replyToName}</span></span
              >`
            : ''}
          ${canEdit
            ? html`<span class="comment-controls">
                <button class="edit-button" @click=${() => this.handleEdit(comment)}>
                  ${this.i18n.t('edit')}
                </button>
                <button class="delete-button" @click=${() => this.handleDelete(comment.id)}>
                  ${this.i18n.t('delete')}
                </button>
              </span>`
            : ''}
        </div>
        <div class="${contentClass}">${this.renderMarkdown(comment.msg)}</div>
        <button class="reply-button" @click=${() => this.setReplyTo(comment.id)}>
          ${this.i18n.t('reply')}
        </button>
        ${isRoot && allReplies
          ? html`<div class="replies">
              ${allReplies.map((reply) => {
                const replyToComment =
                  reply.replyTo && commentMap ? commentMap[reply.replyTo] : undefined;
                const replyToName = replyToComment ? this.getDisplayName(replyToComment) : '';
                return this.createCommentItemTemplate(reply, false, replyToName);
              })}
            </div>`
          : isRoot
          ? html`<div class="replies"></div>`
          : ''}
      </div>
    `;
  }

  private createCommentTemplate(
    rootComment: Comment,
    allReplies: Comment[],
    commentMap: CommentMap,
  ) {
    return this.createCommentItemTemplate(rootComment, true, null, allReplies, commentMap);
  }

  private processComments(data: Comment[]) {
    // no replyTo means it's a root comment
    const rootComments = data.filter((c) => !c.replyTo);

    const replyMap: Record<string, Comment[]> = {};
    data.forEach((comment) => {
      if (comment.replyTo) {
        if (!replyMap[comment.replyTo]) {
          replyMap[comment.replyTo] = [];
        }
        replyMap[comment.replyTo].push(comment);
      }
    });

    const getAllReplies = (commentId: string): Comment[] => {
      const allReplies: Comment[] = [];
      const queue = [...(replyMap[commentId] || [])];

      while (queue.length > 0) {
        const reply = queue.shift();
        if (reply) {
          allReplies.push(reply);

          const childReplies = replyMap[reply.id] || [];
          queue.push(...childReplies);
        }
      }

      return allReplies;
    };

    return rootComments.map((rootComment) => {
      const allReplies = getAllReplies(rootComment.id);
      return this.createCommentTemplate(rootComment, allReplies, this.commentMap);
    });
  }

  private async handleSubmit(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    const name = formData.get('name') as string;
    const message = formData.get('message') as string;

    let success = false;

    if (this.editingComment) {
      success = await this.apiService.updateComment(
        this.post,
        this.editingComment.id,
        name,
        message,
      );

      if (success) {
        (e.target as HTMLFormElement).reset();
        this.previewText = '';
        this.editingComment = null;
        this.renderForm();
        this.renderPreview();
      } else {
        alert(this.i18n.t('editFailed'));
      }
    } else {
      success = await this.apiService.addComment(this.post, name, message, this.currentReplyTo);

      if (success) {
        (e.target as HTMLFormElement).reset();
        this.previewText = '';
        this.currentReplyTo = null;
        this.renderForm();
        this.renderPreview();
      } else {
        alert(this.i18n.t('submitFailed'));
      }
    }

    if (success) {
      this.comments.length = 0;
      await this.renderCommentsList();
    }
  }

  private async handleDelete(commentId: string): Promise<void> {
    if (!confirm(this.i18n.t('confirmDelete'))) return;

    const success = await this.apiService.deleteComment(this.post, commentId);

    if (success) {
      this.comments.length = 0;
      await this.renderCommentsList();
    } else {
      alert(this.i18n.t('deleteFailed'));
    }
  }

  private handleEdit(comment: Comment): void {
    this.editingComment = comment;
    const nameInput = document.querySelector(
      '#comment-form input[name="name"]',
    ) as HTMLInputElement;
    const messageInput = document.querySelector(
      '#comment-form textarea[name="message"]',
    ) as HTMLTextAreaElement;

    if (nameInput) {
      nameInput.value = comment.name || '';
    }

    if (messageInput) {
      messageInput.value = comment.msg || '';
    }

    this.previewText = comment.msg || '';

    this.renderForm();
    this.renderPreview();

    const form = document.querySelector('#comment-form-container');
    if (form) {
      form.scrollIntoView({ behavior: 'smooth' });
    }
  }

  private cancelEdit(): void {
    this.editingComment = null;
    const form = document.querySelector('#comment-form') as HTMLFormElement;
    if (form) {
      form.reset();
    }
    this.previewText = '';
    this.renderForm();
    this.renderPreview();
  }

  private toggleMarkdownHelp(): void {
    this.showMarkdownHelp = !this.showMarkdownHelp;
    this.renderMarkdownHelp();
  }

  private renderMarkdownHelp(): void {
    const helpElement = document.getElementById('markdown-help-modal');
    if (!helpElement) return;

    if (this.showMarkdownHelp) {
      render(this.createMarkdownHelpTemplate(), helpElement);
      helpElement.classList.add('active');
    } else {
      render(html``, helpElement);
      helpElement.classList.remove('active');
    }
  }
  private createMarkdownHelpTemplate() {
    return html`
      <div class="markdown-help-container">
        <div class="markdown-help-backdrop" @click=${() => this.toggleMarkdownHelp()}></div>
        <div class="markdown-help-content">
          <button class="markdown-help-close" @click=${() => this.toggleMarkdownHelp()}>×</button>
          <h4>${this.i18n.t('commentSystemTitle')}</h4>
          <p>${this.i18n.t('commentSystemDesc')}</p>
          <p>${this.i18n.t('commentTimeLimit')}</p>
          <p>
            Powered by&nbsp;<a
              href="https://github.com/ziteh/wonton-comment"
              target="_blank"
              rel="noopener noreferrer"
              >Wonton</a
            >
          </p>
          <h4>${this.i18n.t('markdownSyntax')}</h4>
          <p>${this.i18n.t('markdownBasicSupport')}</p>
          <div class="markdown-examples">
            <code>
              <pre>
${this.i18n.t('markdownLinkExample')}

${this.i18n.t('markdownImageExample')}

${this.i18n.t('markdownItalicExample')}

${this.i18n.t('markdownBoldExample')}

${this.i18n.t('markdownListExample')}

${this.i18n.t('markdownOrderedListExample')}

${this.i18n.t('markdownInlineCodeExample')}

${this.i18n.t('markdownCodeBlockExample')}</pre
              >
            </code>
          </div>
        </div>
      </div>
    `;
  }

  private createFormTemplate() {
    return html`
      <div class="comment-tabs">
        <button
          id="write-tab"
          class="tab ${this.activeTab === 'write' ? 'active' : ''}"
          @click=${() => this.switchTab('write')}
        >
          ${this.i18n.t('write')}
        </button>
        <button
          id="preview-tab"
          class="tab ${this.activeTab === 'preview' ? 'active' : ''}"
          @click=${() => this.switchTab('preview')}
        >
          ${this.i18n.t('preview')}
        </button>
      </div>
      <div class="tab-content">
        <div id="form-content" class="${this.activeTab === 'write' ? 'active' : ''}">
          <form id="comment-form" @submit=${(e: SubmitEvent) => this.handleSubmit(e)}>
            <input type="text" name="name" placeholder="${this.i18n.t('namePlaceholder')}" />
            <textarea
              name="message"
              placeholder="${this.i18n.t('messagePlaceholder')}"
              required
              @input=${(e: Event) => this.handleInputChange(e)}
            ></textarea>
            <div class="form-actions">
              ${this.currentReplyTo && this.commentMap[this.currentReplyTo]
                ? html`<div id="reply-info">
                    ${this.i18n.t('replyingTo')}
                    <span id="reply-to-name"
                      >${this.getDisplayName(this.commentMap[this.currentReplyTo])}</span
                    >
                    <button type="button" @click=${() => this.cancelReply()}>
                      ${this.i18n.t('cancelReply')}
                    </button>
                  </div>`
                : ''}
              ${this.editingComment
                ? html`<div id="edit-info">
                    ${this.i18n.t('editing')}
                    <span id="edit-comment-id">${this.editingComment.id}</span>
                    <button type="button" @click=${() => this.cancelEdit()}>
                      ${this.i18n.t('cancelEdit')}
                    </button>
                  </div>`
                : ''}
              <div class="button-group">
                <button
                  type="button"
                  class="markdown-help-button"
                  title="${this.i18n.t('markdownHelp')}"
                  @click=${() => this.toggleMarkdownHelp()}
                >
                  ?
                </button>
                <button type="submit" class="submit-button">
                  ${this.editingComment
                    ? this.i18n.t('updateComment')
                    : this.i18n.t('submitComment')}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
      <div id="markdown-help-modal"></div>
    `;
  }

  public async renderApp(): Promise<void> {
    const appTemplate = html`
      <div class="wtc-container">
        <div id="comment-form-container"></div>
        <div id="preview-container"></div>
        <div id="comments-container"></div>
      </div>
    `;

    const appElement = document.getElementById(this.elementId);
    if (appElement) {
      render(appTemplate, appElement);
      this.renderForm();
      this.renderPreview();
      await this.renderCommentsList();
      this.renderMarkdownHelp();
    }
  }

  public async refresh(): Promise<void> {
    this.comments = [];
    await this.renderCommentsList();
  }
}

type CommentMap = {
  [id: string]: Comment;
};

export default initWontonComment;
