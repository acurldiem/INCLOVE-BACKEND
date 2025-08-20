import csv
from difflib import get_close_matches

COMMUNITIES = {
    'mobility': 'Mobility Impaired Community',
    'wheelchair': 'Mobility Impaired Community',
    'quadriplegic’: 'Mobility Impaired Community',
    'paraplegic': 'Mobility Impaired Community',
    'cerebral palsy': 'Mobility Impaired Community’,
    'blind': 'Visually Impaired Community',
    'low vision': 'Visually Impaired Community',
    'deaf': 'Deaf/Hard of Hearing Community',
    'hard of hearing': 'Deaf/Hard of Hearing Community',
    'sign language': 'Deaf/Hard of Hearing Community',
    'hoh': 'Deaf/Hard of Hearing Community',
    'chronic': 'Chronic Illness Community',
    'illness': 'Chronic Illness Community',
    'lupus': 'Chronic Illness Community',
    'multiple sclerosis’: 'Chronic Illness Community',
    'muscular dystrophy’: 'Mobility Impaired Community',
    'ms': 'Chronic Illness Community',
    'md': 'Mobility Impaired Community',
    'bipolar': 'Mental Health Community',
    ‘bpd’: ‘Mental Health Community’,
    ‘npd’: ‘Mental Health Community’,
    ‘autism’: ‘Cognitive Health Community’,
    ‘adhd’: ‘Cognitive Health Community’,
    ‘neuro’: ‘Cognitive Health Community’,
    ‘cognitive’: ‘Cognitive Health Community’,
    'anxiety': 'Mental Health Community',
    ‘brain’: ‘Cognitive Health Community’,
    'ptsd': 'Mental Health Community',
    'depression': 'Mental Health Community',
    ‘divergent’: ‘Cognitive Health Community’,
    'personality disorder': 'Mental Health Community',
    'schizo': 'Mental Health Community',
}

def get_user_signup_from_db(user_id):
    with open('models/model_users.csv', newline='', encoding='utf-8') as csvfile:
        reader = csv.DictReader(csvfile)
        for row in reader:
            if int(row['id']) == user_id:
                return {
                    "disability_type": row.get("disability_type", ""),
                    "bio": row.get("bio", ""),
                    "wish": row.get("wish", "")
                }
    return {"disability_type": "", "bio": "", "wish": ""}

def suggest_community(disability_type, bio, wish):
    text = f"{disability_type} {bio} {wish}".lower().split()
    keywords = list(COMMUNITIES.keys())
    matches = []
    for word in text:
        close = get_close_matches(word, keywords, n=1, cutoff=0.8)
        if close:
            matches.append(close[0])
    if matches:
        # Return the community for the first good match found
        return COMMUNITIES[matches]
    return "All Communities"

