"""
Chunks AI — Student Progress & Learning Intelligence
Stateless computation endpoints — frontend sends progress data, backend computes insights.

Endpoints:
  POST /progress/study-plan     — Generate daily study plan from exam date + weak topics
  POST /progress/readiness      — Compute exam readiness score (0–100)
  POST /progress/weak-spots     — Rank topics by weakness from quiz history
  POST /progress/badges         — Compute earned badges from progress data
  GET  /progress/streak-check   — Validate streak (server-side date check)
"""

import os
import json
import math
import logging
from datetime import datetime, date, timedelta
from flask import Blueprint, request, jsonify

logger = logging.getLogger(__name__)

progress_bp = Blueprint('progress', __name__, url_prefix='/progress')

# ── Helpers ───────────────────────────────────────────────────────────────────

BADGE_DEFINITIONS = [
    {'id': 'first_question',   'name': 'First Step',        'icon': '🎯', 'desc': 'Asked your first question',          'condition': lambda p: p.get('totalQuestions', 0) >= 1},
    {'id': 'first_flashcard',  'name': 'Card Shark',        'icon': '🃏', 'desc': 'Completed your first flashcard set', 'condition': lambda p: p.get('totalSessions', 0) >= 1},
    {'id': 'streak_3',         'name': '3-Day Streak',      'icon': '🔥', 'desc': 'Studied 3 days in a row',           'condition': lambda p: p.get('studyStreak', 0) >= 3},
    {'id': 'streak_7',         'name': 'Week Warrior',      'icon': '⚡', 'desc': 'Studied 7 days in a row',           'condition': lambda p: p.get('studyStreak', 0) >= 7},
    {'id': 'streak_30',        'name': 'Month Master',      'icon': '🏆', 'desc': 'Studied 30 days in a row',          'condition': lambda p: p.get('studyStreak', 0) >= 30},
    {'id': 'accuracy_80',      'name': 'Sharp Mind',        'icon': '🧠', 'desc': '80%+ average flashcard accuracy',   'condition': lambda p: _avg_accuracy(p) >= 80},
    {'id': 'accuracy_95',      'name': 'Perfect Scholar',   'icon': '💎', 'desc': '95%+ average flashcard accuracy',   'condition': lambda p: _avg_accuracy(p) >= 95},
    {'id': 'questions_50',     'name': 'Curious Learner',   'icon': '🔍', 'desc': 'Asked 50 questions',                'condition': lambda p: p.get('totalQuestions', 0) >= 50},
    {'id': 'questions_200',    'name': 'Knowledge Seeker',  'icon': '📚', 'desc': 'Asked 200 questions',               'condition': lambda p: p.get('totalQuestions', 0) >= 200},
    {'id': 'cards_100',        'name': 'Card Collector',    'icon': '✨', 'desc': 'Studied 100 flashcards',            'condition': lambda p: p.get('totalCards', 0) >= 100},
    {'id': 'cards_500',        'name': 'Deck Master',       'icon': '🎓', 'desc': 'Studied 500 flashcards',            'condition': lambda p: p.get('totalCards', 0) >= 500},
    {'id': 'quiz_pass',        'name': 'Quiz Crusher',      'icon': '✅', 'desc': 'Scored 70%+ on a quiz',            'condition': lambda p: _best_quiz_score(p) >= 70},
    {'id': 'quiz_perfect',     'name': 'Ace Student',       'icon': '💯', 'desc': 'Scored 100% on a quiz',            'condition': lambda p: _best_quiz_score(p) >= 100},
    {'id': 'study_hour',       'name': 'Hour Scholar',      'icon': '⏱️', 'desc': 'Studied for 1 hour total',         'condition': lambda p: p.get('totalStudyTime', 0) >= 60},
    {'id': 'study_10h',        'name': 'Dedicated Student', 'icon': '🌟', 'desc': 'Studied for 10 hours total',        'condition': lambda p: p.get('totalStudyTime', 0) >= 600},
    {'id': 'readiness_60',     'name': 'Getting There',     'icon': '📈', 'desc': 'Reached 60% exam readiness',        'condition': lambda p: p.get('readinessScore', 0) >= 60},
    {'id': 'readiness_80',     'name': 'Almost Ready',      'icon': '🎯', 'desc': 'Reached 80% exam readiness',        'condition': lambda p: p.get('readinessScore', 0) >= 80},
    {'id': 'readiness_90',     'name': 'Exam Ready!',       'icon': '🚀', 'desc': 'Reached 90% exam readiness',        'condition': lambda p: p.get('readinessScore', 0) >= 90},
]

def _avg_accuracy(p):
    total = p.get('totalCards', 0)
    correct = p.get('totalCorrect', 0)
    return round((correct / total) * 100) if total > 0 else 0

def _best_quiz_score(p):
    quizzes = p.get('quizResults', [])
    if not quizzes:
        return 0
    return max((q.get('score', 0) for q in quizzes), default=0)


@progress_bp.route('/readiness', methods=['POST', 'OPTIONS'])
def compute_readiness():
    """
    Compute exam readiness score (0–100) from client-side progress data.
    Weights:
      30% — Quiz performance (average score across all quizzes)
      25% — Topic coverage (unique topics studied / estimated total)
      20% — Flashcard mastery (% of cards mastered)
      15% — Study consistency (streak / days until exam)
      10% — Study time (hours invested)
    """
    if request.method == 'OPTIONS':
        return jsonify({'ok': True})

    data     = request.json or {}
    progress = data.get('progress', {})
    exam_date_str = data.get('examDate', '')

    # ── 1. Quiz performance (30%) ──────────────────────────────────────────
    quiz_results = progress.get('quizResults', [])
    if quiz_results:
        avg_quiz = sum(q.get('score', 0) for q in quiz_results) / len(quiz_results)
    else:
        avg_quiz = 0
    quiz_score = min(100, avg_quiz)

    # ── 2. Topic coverage (25%) ────────────────────────────────────────────
    topics_studied = len(progress.get('topics', {}))
    # Estimate: a typical textbook chapter has ~5 key topics
    # 10+ unique topics = considered full coverage
    coverage_score = min(100, (topics_studied / 10) * 100)

    # ── 3. Flashcard mastery (20%) ─────────────────────────────────────────
    total_cards   = progress.get('totalCards', 0)
    total_correct = progress.get('totalCorrect', 0)
    mastery_score = round((total_correct / total_cards) * 100) if total_cards > 0 else 0

    # ── 4. Study consistency (15%) ─────────────────────────────────────────
    streak = progress.get('studyStreak', 0)
    if exam_date_str:
        try:
            exam_dt    = datetime.strptime(exam_date_str, '%Y-%m-%d').date()
            days_left  = max(1, (exam_dt - date.today()).days)
            # Ideal: study every day until exam
            ideal_days = min(days_left, 14)  # cap at 2 weeks
            consistency_score = min(100, (streak / max(1, ideal_days)) * 100)
        except Exception:
            consistency_score = min(100, streak * 10)
    else:
        consistency_score = min(100, streak * 10)

    # ── 5. Study time (10%) ────────────────────────────────────────────────
    total_minutes  = progress.get('totalStudyTime', 0)
    # 5 hours of study = 100%
    time_score = min(100, (total_minutes / 300) * 100)

    # ── Weighted total ─────────────────────────────────────────────────────
    readiness = (
        quiz_score        * 0.30 +
        coverage_score    * 0.25 +
        mastery_score     * 0.20 +
        consistency_score * 0.15 +
        time_score        * 0.10
    )
    readiness = round(readiness)

    # ── Verdict ────────────────────────────────────────────────────────────
    if readiness >= 85:
        verdict = "You're ready. Go get some sleep."
        color   = '#10b981'
    elif readiness >= 70:
        verdict = "Almost there. Focus on your weak spots."
        color   = '#3b82f6'
    elif readiness >= 50:
        verdict = "Making progress. Keep studying."
        color   = '#f59e0b'
    elif readiness >= 30:
        verdict = "More practice needed. Use the study plan."
        color   = '#f97316'
    else:
        verdict = "Just getting started. Consistency is key."
        color   = '#ef4444'

    return jsonify({
        'success':   True,
        'readiness': readiness,
        'verdict':   verdict,
        'color':     color,
        'breakdown': {
            'quiz_performance':  round(quiz_score),
            'topic_coverage':    round(coverage_score),
            'flashcard_mastery': round(mastery_score),
            'consistency':       round(consistency_score),
            'study_time':        round(time_score),
        }
    })


@progress_bp.route('/weak-spots', methods=['POST', 'OPTIONS'])
def get_weak_spots():
    """
    Rank topics by weakness. Returns topics that need most work.
    Input: progress.quizResults = [{topic, score, wrongTopics: ['entropy','equilibrium']}]
    """
    if request.method == 'OPTIONS':
        return jsonify({'ok': True})

    data     = request.json or {}
    progress = data.get('progress', {})

    # Count wrong answers per topic
    topic_wrong  = {}  # topic → wrong count
    topic_total  = {}  # topic → total questions seen
    topic_recent = {}  # topic → most recent date

    for result in progress.get('quizResults', []):
        topic   = result.get('topic', 'Unknown')
        score   = result.get('score', 0)
        total_q = result.get('totalQuestions', 10)
        wrong_q = result.get('wrongTopics', [])
        ts      = result.get('timestamp', '')

        wrong_count = round(total_q * (1 - score / 100))
        topic_wrong[topic]  = topic_wrong.get(topic, 0) + wrong_count
        topic_total[topic]  = topic_total.get(topic, 0) + total_q
        topic_recent[topic] = ts

        # Also track granular wrong topics if provided
        for wt in wrong_q:
            topic_wrong[wt]  = topic_wrong.get(wt, 0) + 1
            topic_total[wt]  = topic_total.get(wt, 0) + 1
            topic_recent[wt] = ts

    # Also factor in flashcard accuracy per topic
    for topic, tdata in progress.get('topics', {}).items():
        sessions = tdata.get('sessions', [])
        for s in sessions:
            wrong = s.get('incorrect', 0)
            total = s.get('cardsStudied', 0)
            if total > 0:
                topic_wrong[topic] = topic_wrong.get(topic, 0) + wrong
                topic_total[topic] = topic_total.get(topic, 0) + total

    # Compute error rate and rank
    weak_spots = []
    for topic, wrong in topic_wrong.items():
        total   = topic_total.get(topic, 1)
        err_rate = round((wrong / total) * 100)
        if err_rate > 0:
            weak_spots.append({
                'topic':      topic,
                'errorRate':  err_rate,
                'wrongCount': wrong,
                'totalSeen':  total,
                'lastSeen':   topic_recent.get(topic, ''),
                'severity':   'high' if err_rate >= 60 else 'medium' if err_rate >= 30 else 'low',
            })

    weak_spots.sort(key=lambda x: x['errorRate'], reverse=True)

    return jsonify({
        'success':    True,
        'weakSpots':  weak_spots[:10],
        'totalWeak':  len([w for w in weak_spots if w['severity'] in ('high', 'medium')]),
    })


@progress_bp.route('/study-plan', methods=['POST', 'OPTIONS'])
def generate_study_plan():
    """
    Generate a daily study plan.
    Input: { examDate, bookId, progress, weakSpots }
    Returns: { days: [{date, tasks: [{type, topic, duration, priority}]}] }
    """
    if request.method == 'OPTIONS':
        return jsonify({'ok': True})

    data          = request.json or {}
    exam_date_str = data.get('examDate', '')
    book_id       = data.get('bookId', 'zumdahl')
    progress      = data.get('progress', {})
    weak_spots    = data.get('weakSpots', [])

    if not exam_date_str:
        return jsonify({'success': False, 'error': 'examDate required'}), 400

    try:
        exam_dt   = datetime.strptime(exam_date_str, '%Y-%m-%d').date()
        days_left = (exam_dt - date.today()).days
    except Exception:
        return jsonify({'success': False, 'error': 'Invalid date format. Use YYYY-MM-DD'}), 400

    if days_left < 0:
        return jsonify({'success': False, 'error': 'Exam date is in the past'}), 400

    if days_left == 0:
        return jsonify({
            'success': True,
            'daysLeft': 0,
            'days': [{
                'date':  exam_date_str,
                'label': 'Exam Day!',
                'tasks': [
                    {'type': 'review',    'topic': 'Review your weak spots only', 'duration': 30, 'priority': 'high'},
                    {'type': 'rest',      'topic': 'Eat well, sleep early',       'duration': 0,  'priority': 'high'},
                ]
            }]
        })

    # Build task pool
    # Priority 1: weak spots (high error rate topics)
    # Priority 2: topics not yet studied
    # Priority 3: review previously studied topics
    # Final day: full mock exam

    studied_topics = set(progress.get('topics', {}).keys())
    weak_topic_names = [w['topic'] for w in weak_spots if w['severity'] in ('high', 'medium')]

    # Build day-by-day plan
    plan_days = min(days_left, 14)  # show max 2 weeks ahead
    days = []

    for i in range(plan_days):
        current_date = date.today() + timedelta(days=i)
        is_exam_eve  = (i == days_left - 1)
        is_today     = (i == 0)

        if is_exam_eve:
            tasks = [
                {'type': 'review',  'topic': 'Quick review of all weak spots', 'duration': 45, 'priority': 'high'},
                {'type': 'rest',    'topic': 'Light review only — no new topics', 'duration': 0, 'priority': 'medium'},
                {'type': 'rest',    'topic': 'Sleep early (8+ hours)',           'duration': 0, 'priority': 'high'},
            ]
        elif i == days_left - 2 and days_left > 3:
            tasks = [
                {'type': 'mock_exam', 'topic': 'Full mock exam — timed practice', 'duration': 60, 'priority': 'high'},
                {'type': 'review',    'topic': 'Review wrong answers after exam', 'duration': 30, 'priority': 'high'},
            ]
        else:
            tasks = []
            # Rotate through weak spots
            if weak_topic_names:
                slot = i % len(weak_topic_names)
                tasks.append({
                    'type':     'weak_spot',
                    'topic':    f'⚠️ Weak spot: {weak_topic_names[slot]}',
                    'duration': 25,
                    'priority': 'high',
                })
            # Add flashcard session
            tasks.append({
                'type':     'flashcard',
                'topic':    'Flashcard review session',
                'duration': 20,
                'priority': 'medium',
            })
            # Add reading/chat session
            tasks.append({
                'type':     'study',
                'topic':    'Ask questions on today\'s topic',
                'duration': 30,
                'priority': 'medium',
            })

        days.append({
            'date':    current_date.strftime('%Y-%m-%d'),
            'label':   'Today' if is_today else ('Exam Eve!' if is_exam_eve else current_date.strftime('%a, %b %d')),
            'isToday': is_today,
            'tasks':   tasks,
            'totalMinutes': sum(t['duration'] for t in tasks),
        })

    return jsonify({
        'success':  True,
        'daysLeft': days_left,
        'examDate': exam_date_str,
        'bookId':   book_id,
        'days':     days,
    })


@progress_bp.route('/badges', methods=['POST', 'OPTIONS'])
def compute_badges():
    """Compute which badges have been earned from progress data."""
    if request.method == 'OPTIONS':
        return jsonify({'ok': True})

    data     = request.json or {}
    progress = data.get('progress', {})

    earned = []
    locked = []

    for badge in BADGE_DEFINITIONS:
        try:
            is_earned = badge['condition'](progress)
        except Exception:
            is_earned = False

        entry = {
            'id':   badge['id'],
            'name': badge['name'],
            'icon': badge['icon'],
            'desc': badge['desc'],
        }
        if is_earned:
            earned.append(entry)
        else:
            locked.append(entry)

    return jsonify({
        'success': True,
        'earned':  earned,
        'locked':  locked[:6],  # Show next 6 to earn
        'total':   len(BADGE_DEFINITIONS),
        'earnedCount': len(earned),
    })


@progress_bp.route('/streak-check', methods=['POST', 'OPTIONS'])
def streak_check():
    """
    Server-side streak validation.
    Prevents streak gaming by verifying timestamps.
    """
    if request.method == 'OPTIONS':
        return jsonify({'ok': True})

    data          = request.json or {}
    last_studied  = data.get('lastStudied', '')
    current_streak = int(data.get('currentStreak', 0))

    today     = date.today()
    yesterday = today - timedelta(days=1)

    if not last_studied:
        return jsonify({'success': True, 'streak': 0, 'status': 'no_history'})

    try:
        last_dt = datetime.fromisoformat(last_studied.replace('Z', '+00:00')).date()
    except Exception:
        return jsonify({'success': True, 'streak': current_streak, 'status': 'parse_error'})

    if last_dt == today:
        status = 'active_today'
        streak = current_streak
    elif last_dt == yesterday:
        status = 'needs_activity'  # studied yesterday, streak alive but needs today
        streak = current_streak
    else:
        status = 'broken'
        streak = 0

    return jsonify({
        'success': True,
        'streak':  streak,
        'status':  status,
        'lastStudied': last_studied,
    })


def register_progress(app):
    app.register_blueprint(progress_bp)
    logger.info('✅ Progress routes: /progress/readiness /progress/weak-spots /progress/study-plan /progress/badges')
