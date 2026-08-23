-- Seed data for the Phase 2 onboarding questionnaire (v1). Kept as a
-- migration, not a one-off script, so `npm run migrate` alone is enough to
-- get a fully working dev environment.

insert into questionnaire_versions (version, is_active, schema)
values (
  1,
  true,
  $json$[
    {
      "id": "values_priority",
      "type": "multi_select",
      "prompt": "Which of these matter most to you in a partner? Pick up to 3.",
      "options": ["Honesty", "Ambition", "Kindness", "Humor", "Independence", "Family-orientation", "Adventure", "Stability", "Spirituality", "Intellectual curiosity"],
      "maxSelect": 3
    },
    {
      "id": "communication_style",
      "type": "likert",
      "prompt": "When something's bothering me, I'd rather talk it out immediately than sit with it first.",
      "scale": [1, 5]
    },
    {
      "id": "conflict_style",
      "type": "free_text",
      "prompt": "Describe how you typically handle disagreements with someone close to you."
    },
    {
      "id": "attachment_check",
      "type": "likert",
      "prompt": "I feel comfortable relying on a partner and having them rely on me.",
      "scale": [1, 5]
    },
    {
      "id": "relationship_goal",
      "type": "single_select",
      "prompt": "What are you looking for right now?",
      "options": ["Long-term relationship", "Marriage", "Something serious but open-ended", "Not sure yet, exploring"]
    },
    {
      "id": "dealbreakers",
      "type": "free_text",
      "prompt": "Is there anything that's an absolute dealbreaker for you in a partner?"
    },
    {
      "id": "ideal_weekend",
      "type": "free_text",
      "prompt": "Describe your ideal weekend."
    },
    {
      "id": "family_involvement",
      "type": "likert",
      "prompt": "Family approval and involvement in my relationship matters a lot to me.",
      "scale": [1, 5]
    }
  ]$json$::jsonb
);
