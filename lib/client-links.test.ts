import { describe, expect, it } from 'vitest';
import { CLIENT_LINKS_MAX, linkLabel, parseClientLinks } from './client-links';

describe('client links on a work order', () => {
  it('takes one link per line and adds https:// when missing', () => {
    expect(parseClientLinks('https://deliverables.example.com/site/5011876\n  survey.example.com  \n')).toEqual([
      'https://deliverables.example.com/site/5011876',
      'https://survey.example.com/',
    ]);
  });

  it('drops blank lines, words and repeats', () => {
    expect(parseClientLinks('\nupload here\nnotalink\nhttps://a.example.com\nhttps://a.example.com\n')).toEqual(['https://a.example.com/']);
  });

  it('keeps at most the limit', () => {
    const many = Array.from({ length: 15 }, (_, i) => `https://s${i}.example.com`).join('\n');
    expect(parseClientLinks(many)).toHaveLength(CLIENT_LINKS_MAX);
  });

  it("labels a button with the site and path", () => {
    expect(linkLabel('https://www.deliverables.example.com/site/5011876/')).toBe('deliverables.example.com/site/5011876');
    expect(linkLabel('https://survey.example.com/')).toBe('survey.example.com');
  });
});

describe('links in a pasted email (Generate with AI)', async () => {
  const { linksInText, mergeLinks } = await import('./client-links');
  const email = `All deliverable will be sent to this link: https://drive.google.com/drive/folders/1WcqYoBmnTB3e_Xis4t7r66w7YQO7A1bP

After each day you are required to check out on this link: https://app.smartsheet.com/b/form/01a13c4a09bf7ac8bb9c6fdd595e1a82.`;
  it('finds every link, without the full stop that ends the sentence', () => {
    expect(linksInText(email)).toEqual([
      'https://drive.google.com/drive/folders/1WcqYoBmnTB3e_Xis4t7r66w7YQO7A1bP',
      'https://app.smartsheet.com/b/form/01a13c4a09bf7ac8bb9c6fdd595e1a82',
    ]);
  });
  it('merges two lists without repeats', () => {
    expect(mergeLinks(['https://a.example.com/x'], ['https://a.example.com/x', 'https://b.example.com'])).toEqual(['https://a.example.com/x', 'https://b.example.com/']);
  });
});
