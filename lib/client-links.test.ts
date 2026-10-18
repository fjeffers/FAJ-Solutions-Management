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
