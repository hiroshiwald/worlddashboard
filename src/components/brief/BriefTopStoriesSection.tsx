"use client";

import { BriefTopStory } from "@/hooks/useBriefTab";
import { timeAgo } from "@/lib/date-utils";

interface BriefTopStoriesSectionProps {
  stories: BriefTopStory[];
  dark: boolean;
}

export default function BriefTopStoriesSection({ stories, dark }: BriefTopStoriesSectionProps) {
  if (stories.length === 0) return null;

  return (
    <div>
      <h3 className={`text-xs font-bold uppercase tracking-wide mb-2 ${dark ? "text-slate-400" : "text-gray-500"}`}>
        Top stories
      </h3>
      <div className={`rounded-xl border divide-y ${dark ? "bg-slate-900 border-slate-700 divide-slate-800" : "bg-white border-gray-100 divide-gray-100 shadow-sm"}`}>
        {stories.map((story) => (
          <div key={story.id} className="flex items-center gap-3 px-4 py-2.5">
            <a
              href={story.link}
              target="_blank"
              rel="noopener noreferrer"
              className={`text-sm flex-1 min-w-0 truncate hover:underline ${dark ? "text-slate-100 hover:text-blue-300" : "text-gray-900 hover:text-blue-600"}`}
            >
              {story.title}
            </a>
            <span className={`text-xs flex-shrink-0 ${dark ? "text-slate-500" : "text-gray-400"}`}>
              {story.clusterSize} article{story.clusterSize === 1 ? "" : "s"} &middot; {story.sourceCount} source{story.sourceCount === 1 ? "" : "s"} &middot; {timeAgo(story.publishedAt)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
