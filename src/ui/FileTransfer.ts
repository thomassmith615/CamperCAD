/**
 * Browser file input and output.
 *
 * Isolated from the project service so that saving, loading and validation stay
 * testable without a DOM, and so the day this gains drag-and-drop or the File
 * System Access API it is the only file that changes.
 */
export class FileTransfer {
  /**
   * Offers a text file to the user as a download.
   *
   * The object URL is revoked on the next tick rather than immediately: Safari
   * cancels the download if the URL disappears before the navigation starts.
   *
   * @param filename Suggested name, including extension.
   * @param text File contents.
   * @param mime MIME type of the contents.
   */
  static download(filename: string, text: string, mime = 'application/json'): void {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);

    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';

    document.body.append(anchor);
    anchor.click();
    anchor.remove();

    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  /**
   * Asks the user for a file and reads it as text.
   *
   * @param accept Value for the input's `accept` attribute.
   * @returns The file's name and contents, or null when the picker was
   * dismissed. Dismissal fires no event in any browser, so the promise settles
   * on window focus instead — without that, a cancelled picker would leave the
   * caller awaiting forever.
   */
  static async pickText(accept = '.json,application/json'): Promise<{ name: string; text: string } | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.style.display = 'none';

      let settled = false;
      const finish = (result: { name: string; text: string } | null) => {
        if (settled) return;
        settled = true;
        window.removeEventListener('focus', onFocus);
        input.remove();
        resolve(result);
      };

      const onFocus = () => {
        // Focus returns before the change event fires, so give the browser a
        // moment to deliver a selection before treating this as a cancellation.
        setTimeout(() => finish(null), 400);
      };

      input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (!file) {
          finish(null);
          return;
        }
        file
          .text()
          .then((text) => finish({ name: file.name, text }))
          .catch(() => finish(null));
      });

      document.body.append(input);
      window.addEventListener('focus', onFocus, { once: true });
      input.click();
    });
  }
}
