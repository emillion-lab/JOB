import { getText, clean } from '../lib.mjs';
import { toJob } from '../normalize.mjs';

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? clean(m[1].replace(/<!\[CDATA\[|\]\]>/g, '')) : '';
};

const link = xml =>
  tag(xml, 'link') ||
  xml.match(/<link[^>]*href=["']([^"']+)["']/i)?.[1] ||
  tag(xml, 'guid');

/**
 * Any RSS or Atom job feed the user pastes into settings: company career feeds,
 * saved-search alerts, government boards, niche sites. This is the escape hatch
 * that keeps the agent from depending on a single aggregator.
 */
export default {
  id: 'feeds',
  async collect({ config }) {
    const jobs = [];
    for (const entry of config.urls || []) {
      const url = typeof entry === 'string' ? entry : entry.url;
      const company = typeof entry === 'string' ? '' : entry.company || '';
      const xml = await getText(url, { label: `feed:${url}` });
      if (!xml) continue;
      const items = xml.match(/<(item|entry)[\s\S]*?<\/\1>/gi) || [];
      for (const item of items.slice(0, 60)) {
        const job = toJob({
          title: tag(item, 'title'),
          company: company || tag(item, 'dc:creator') || tag(item, 'author') || new URL(url).hostname,
          location: tag(item, 'location') || tag(item, 'job_location'),
          description: tag(item, 'content:encoded') || tag(item, 'description') || tag(item, 'summary'),
          url: link(item),
          posted: tag(item, 'pubDate') || tag(item, 'published') || tag(item, 'updated')
        }, 'feeds');
        if (job) jobs.push(job);
      }
    }
    return jobs;
  }
};
