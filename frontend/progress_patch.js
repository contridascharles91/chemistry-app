/**
 * Chunks AI — Student Intelligence Patch v3
 * Full activity logging, XP/gamification, streak engine, engagement hooks
 */
(function () {
  'use strict';
  var API = window.__API_URL__ || 'https://chunksai.up.railway.app';

  function getProgress() { try { return JSON.parse(localStorage.getItem('chunks_progress') || '{}'); } catch(e) { return {}; } }
  function saveProgress(p) { try { localStorage.setItem('chunks_progress', JSON.stringify(p)); } catch(e) {} }
  function getSRData() { try { return JSON.parse(localStorage.getItem('chunks_sr_data') || '{}'); } catch(e) { return {}; } }
  function saveSRData(d) { try { localStorage.setItem('chunks_sr_data', JSON.stringify(d)); } catch(e) {} }

  var XP_TABLE = {
    message_sent:2, quiz_correct:10, quiz_wrong:2, quiz_completed:20,
    flashcard_correct:5, flashcard_hard:3, flashcard_session:15,
    page_read:3, pdf_loaded:10, sf_quiz_completed:25, sf_task_done:15,
    daily_login:20, streak_3:30, streak_7:75, streak_30:200
  };

  var LEVELS = [
    {min:0,label:'Freshman',color:'#94a3b8'},{min:50,label:'Scholar',color:'#60a5fa'},
    {min:150,label:'Thinker',color:'#34d399'},{min:350,label:'Analyst',color:'#a78bfa'},
    {min:700,label:'Expert',color:'#f59e0b'},{min:1200,label:'Master',color:'#f97316'},
    {min:2000,label:'Genius',color:'#ef4444'},{min:3500,label:'Legend',color:'#ec4899'}
  ];
  function getLevel(xp){var l=LEVELS[0];for(var i=0;i<LEVELS.length;i++){if(xp>=LEVELS[i].min)l=LEVELS[i];}return l;}
  function getNextLevel(xp){for(var i=0;i<LEVELS.length;i++){if(xp<LEVELS[i].min)return LEVELS[i];}return null;}

  var _xpQueue=[], _xpTimer=null;
  function earnXP(type, context) {
    var pts = XP_TABLE[type]||0; if(!pts)return;
    var p=getProgress(); if(!p.xp)p.xp=0;
    var oldXP=p.xp; p.xp+=pts;
    var oldLvl=getLevel(oldXP).label, newLvl=getLevel(p.xp).label;
    saveProgress(p);
    _logActivity(type,pts,context);
    _xpQueue.push(pts);
    if(!_xpTimer){_xpTimer=setTimeout(function(){
      var tot=_xpQueue.reduce(function(s,v){return s+v;},0); _xpQueue=[]; _xpTimer=null;
      _xpToast('+'+tot+' XP');
    },900);}
    if(newLvl!==oldLvl)setTimeout(function(){_levelUpCelebration(newLvl,getLevel(p.xp).color);},400);
    setTimeout(_renderXPBar,100);
  }

  var ACTIVITY_ICONS={message_sent:'💬',quiz_correct:'✅',quiz_wrong:'❌',quiz_completed:'🏆',
    flashcard_correct:'🃏',flashcard_hard:'🔄',flashcard_session:'🎴',page_read:'📖',
    pdf_loaded:'📄',sf_quiz_completed:'📊',sf_task_done:'✔️',daily_login:'🌅',
    streak_3:'🔥',streak_7:'🔥🔥',streak_30:'🔥🔥🔥'};
  function _logActivity(type,xp,context){
    var p=getProgress(); if(!p.activityFeed)p.activityFeed=[];
    p.activityFeed.unshift({type:type,icon:ACTIVITY_ICONS[type]||'⚡',xp:xp,context:context||'',ts:Date.now()});
    if(p.activityFeed.length>100)p.activityFeed=p.activityFeed.slice(0,100);
    saveProgress(p);
  }

  var ACHIEVEMENTS=[
    {id:'first_message',icon:'💬',name:'First Word',desc:'Sent your first message',check:function(p){return(p.totalMessages||0)>=1;}},
    {id:'first_quiz',icon:'📝',name:'Quiz Taker',desc:'Completed your first quiz',check:function(p){return(p.totalQuizzes||0)>=1;}},
    {id:'quiz_ace',icon:'⭐',name:'Quiz Ace',desc:'Got 100% on a quiz',check:function(p){return!!p.quizAce;}},
    {id:'streak_3',icon:'🔥',name:'On Fire',desc:'3-day streak',check:function(p){return(p.streak||0)>=3;}},
    {id:'streak_7',icon:'🔥',name:'Week Warrior',desc:'7-day streak',check:function(p){return(p.streak||0)>=7;}},
    {id:'flashcard_50',icon:'🃏',name:'Card Shark',desc:'Reviewed 50 flashcards',check:function(p){return(p.totalFlashcards||0)>=50;}},
    {id:'pages_25',icon:'📚',name:'Bookworm',desc:'Read 25 pages',check:function(p){return(p.totalPagesRead||0)>=25;}},
    {id:'messages_50',icon:'🤖',name:'Power Student',desc:'Asked 50 questions',check:function(p){return(p.totalMessages||0)>=50;}},
    {id:'level_expert',icon:'🎓',name:'Expert Reached',desc:'Reached Expert level',check:function(p){return(p.xp||0)>=700;}},
    {id:'all_tools',icon:'🧰',name:'Full Toolkit',desc:'Used all 6 study tools',check:function(p){return(p.toolsUsed||[]).length>=6;}}
  ];
  function checkAchievements(){
    var p=getProgress(); if(!p.achievements)p.achievements=[];
    var earned=p.achievements.map(function(a){return a.id;});
    ACHIEVEMENTS.forEach(function(a){
      if(earned.indexOf(a.id)===-1&&a.check(p)){
        p.achievements.push({id:a.id,ts:Date.now()});
        saveProgress(p);
        setTimeout(function(){_achievementToast(a);},600);
      }
    });
  }

  function _checkStreak(){
    var p=getProgress();
    var today=new Date().toISOString().slice(0,10);
    var last=p.lastActiveDay||'';
    if(last===today)return;
    var yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);
    if(last===yesterday){p.streak=(p.streak||0)+1;}
    else if(last&&last<yesterday){p.streak=1;}
    else{p.streak=(p.streak||0)+1;}
    p.lastActiveDay=today;
    p.longestStreak=Math.max(p.streak,p.longestStreak||0);
    p.xp=(p.xp||0)+XP_TABLE.daily_login;
    _logActivity('daily_login',XP_TABLE.daily_login,'Day '+p.streak);
    saveProgress(p);
    if(p.streak===3)setTimeout(function(){earnXP('streak_3','3-day streak!');},500);
    if(p.streak===7)setTimeout(function(){earnXP('streak_7','7-day streak!');},500);
    if(p.streak===30)setTimeout(function(){earnXP('streak_30','30-day streak!');},500);
    checkAchievements();
  }

  function _ensureStyles(){
    if(document.getElementById('patchStyles'))return;
    var s=document.createElement('style'); s.id='patchStyles';
    s.textContent='@keyframes xpPop{from{opacity:0;transform:translateY(10px) scale(.8);}to{opacity:1;transform:none;}}'+
      '@keyframes xpFade{to{opacity:0;transform:translateY(-8px);}}'+
      '@keyframes confettiFall{0%{opacity:1;}100%{transform:translateY(110vh) rotate(720deg);opacity:0;}}';
    document.head.appendChild(s);
  }

  function _xpToast(label){
    _ensureStyles();
    var t=document.createElement('div');
    t.style.cssText='position:fixed;bottom:80px;right:20px;z-index:99999;background:rgba(99,102,241,.92);color:#fff;padding:7px 14px;border-radius:20px;font-size:13px;font-weight:700;font-family:inherit;pointer-events:none;animation:xpPop .4s cubic-bezier(.175,.885,.32,1.275) both;box-shadow:0 4px 20px rgba(99,102,241,.4);';
    t.textContent=label+' ✨';
    document.body.appendChild(t);
    setTimeout(function(){t.style.animation='xpFade .3s ease forwards';setTimeout(function(){t.remove();},350);},2200);
  }

  function _achievementToast(a){
    _ensureStyles();
    var t=document.createElement('div');
    t.style.cssText='position:fixed;bottom:80px;left:50%;transform:translateX(-50%);z-index:99999;background:linear-gradient(135deg,rgba(245,158,11,.96),rgba(249,115,22,.96));color:#fff;padding:12px 20px;border-radius:14px;font-size:14px;font-weight:700;font-family:inherit;text-align:center;box-shadow:0 8px 30px rgba(245,158,11,.4);animation:xpPop .5s cubic-bezier(.175,.885,.32,1.275) both;pointer-events:none;min-width:240px;';
    t.innerHTML='<div style="font-size:22px;margin-bottom:3px;">'+a.icon+'</div><div>'+a.name+' unlocked!</div><div style="font-size:11px;opacity:.85;margin-top:2px;">'+a.desc+'</div>';
    document.body.appendChild(t);
    _confetti();
    setTimeout(function(){t.style.animation='xpFade .4s ease forwards';setTimeout(function(){t.remove();},400);},3500);
  }

  function _levelUpCelebration(levelName,color){
    _ensureStyles();
    var t=document.createElement('div');
    t.style.cssText='position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:99999;background:rgba(10,10,20,.97);border:2px solid '+color+';color:#fff;padding:24px 36px;border-radius:20px;font-family:inherit;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.6);animation:xpPop .5s cubic-bezier(.175,.885,.32,1.275) both;';
    t.innerHTML='<div style="font-size:36px;margin-bottom:8px;">🎓</div><div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:'+color+';font-weight:700;">Level Up!</div><div style="font-size:28px;font-weight:900;margin:6px 0;color:'+color+';">'+levelName+'</div><div style="font-size:12px;opacity:.5;margin-top:8px;">Tap to continue</div>';
    t.onclick=function(){t.remove();};
    document.body.appendChild(t);
    _confetti();
    setTimeout(function(){if(t.parentNode)t.remove();},6000);
  }

  function _confetti(){
    _ensureStyles();
    var colors=['#6366f1','#a855f7','#f59e0b','#10b981','#ef4444','#3b82f6'];
    for(var i=0;i<42;i++){(function(i){
      setTimeout(function(){
        var c=document.createElement('div');
        var col=colors[Math.floor(Math.random()*colors.length)];
        var x=Math.random()*window.innerWidth;
        c.style.cssText='position:fixed;top:-10px;left:'+x+'px;width:'+(6+Math.random()*6)+'px;height:'+(6+Math.random()*6)+'px;background:'+col+';border-radius:'+(Math.random()>.5?'50%':'2px')+';z-index:99998;pointer-events:none;animation:confettiFall '+(1.2+Math.random()*.8)+'s ease-in forwards;';
        document.body.appendChild(c);
        setTimeout(function(){if(c.parentNode)c.remove();},2200);
      },i*35);
    })(i);}
  }

  function _renderXPBar(){
    var p=getProgress(); var xp=p.xp||0;
    var lvl=getLevel(xp); var nextLvl=getNextLevel(xp);
    var pct=nextLvl?Math.round(((xp-lvl.min)/(nextLvl.min-lvl.min))*100):100;
    var streak=p.streak||0;
    var bar=document.getElementById('chunks-xp-bar');
    var isNew=!bar;
    if(!bar){
      var anchor=document.querySelector('.sidebar-profile')||document.querySelector('.sidebar-bottom')||document.getElementById('chat-history-sidebar');
      if(!anchor)return;
      bar=document.createElement('div'); bar.id='chunks-xp-bar';
      bar.style.cssText='padding:10px 14px 6px;border-top:1px solid rgba(255,255,255,.06);';
      anchor.appendChild(bar);
    }
    // Start fill at 0 on first render, animate to real value
    var fillPct=isNew?0:pct;
    bar.innerHTML=
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px;">'+
        '<div style="display:flex;align-items:center;gap:6px;">'+
          '<div style="width:20px;height:20px;border-radius:6px;background:linear-gradient(135deg,'+lvl.color+',rgba(255,255,255,.25));display:flex;align-items:center;justify-content:center;font-size:10px;">⚡</div>'+
          '<span style="font-size:11px;font-weight:700;color:'+lvl.color+';">'+lvl.label+'</span>'+
        '</div>'+
        '<div style="display:flex;align-items:center;gap:8px;">'+
          (streak>0?'<span style="font-size:11px;font-weight:700;color:#f59e0b;">🔥 '+streak+'</span>':'')+
          '<span style="font-size:10px;color:rgba(255,255,255,.28);">'+xp+' XP</span>'+
        '</div>'+
      '</div>'+
      '<div style="height:4px;background:rgba(255,255,255,.07);border-radius:100px;overflow:hidden;">'+
        '<div id="chunks-xp-bar-fill" style="height:100%;width:'+fillPct+'%;background:linear-gradient(90deg,'+lvl.color+',rgba(255,255,255,.45));border-radius:100px;transition:width .6s ease;"></div>'+
      '</div>'+
      (nextLvl?'<div style="font-size:10px;color:rgba(255,255,255,.2);margin-top:3px;text-align:right;">Next: '+nextLvl.label+' ('+(nextLvl.min-xp)+' XP)</div>':'');
    if(isNew){setTimeout(function(){var f=document.getElementById('chunks-xp-bar-fill');if(f)f.style.width=pct+'%';},120);}
  }

  function _patchHandleAnswer(){
    var _orig=window.handleMatExamAnswer;
    window.handleMatExamAnswer=function(btn){
      if(typeof _orig==='function')_orig.call(this,btn);
      var ts=(btn&&btn.dataset)?btn.dataset.examts:null; if(!ts)return;
      var listEl=document.getElementById('matexam-list-'+ts); if(!listEl)return;
      var allQs=listEl.querySelectorAll('.exam-question');
      var total=allQs.length,answered=0,correct=0;
      allQs.forEach(function(el){
        if(el.querySelectorAll('.exam-option[disabled]').length>0){
          answered++;
          if(!el.querySelector('.exam-wrong'))correct++;
        }
      });
      var lastQ=btn.closest('.exam-question');
      if(lastQ){var wasCorrect=!lastQ.querySelector('.exam-wrong');earnXP(wasCorrect?'quiz_correct':'quiz_wrong','');}
      if(answered===total&&total>0){
        var pct=Math.round((correct/total)*100);
        var topic=(window._currentUploadFilename||'General').replace(/\.[^.]+$/,'');
        var p=getProgress(); p.totalQuizzes=(p.totalQuizzes||0)+1;
        if(pct===100)p.quizAce=true; saveProgress(p);
        earnXP('quiz_completed',topic+' — '+pct+'%');
        _saveQuizResult({topic:topic,score:pct,correct:correct,total:total,ts:Date.now()});
        checkAchievements();
        setTimeout(function(){if(typeof window.renderSidebarProgress==='function')window.renderSidebarProgress();},300);
      }
    };
  }
  function _saveQuizResult(r){
    var p=getProgress(); if(!p.quizHistory)p.quizHistory=[];
    p.quizHistory.unshift(r); if(p.quizHistory.length>50)p.quizHistory=p.quizHistory.slice(0,50);
    saveProgress(p);
  }

  function _patchSendMessage(){
    var _orig=window.sendMessage; if(!_orig){setTimeout(_patchSendMessage,100);return;}
    window.sendMessage=async function(){
      var input=document.getElementById('chat-input');
      var msg=input?input.value.trim():'';
      if(msg&&!msg.startsWith('[')){
        var p=getProgress(); p.totalMessages=(p.totalMessages||0)+1; saveProgress(p);
        earnXP('message_sent',msg.substring(0,40)); checkAchievements();
      }
      return _orig.apply(this,arguments);
    };
  }

  function _patchSfQuiz(){
    var _orig=window.sfShowResults; if(!_orig){setTimeout(_patchSfQuiz,200);return;}
    window.sfShowResults=function(){
      var p=getProgress(); p.totalQuizzes=(p.totalQuizzes||0)+1; saveProgress(p);
      earnXP('sf_quiz_completed','Diagnostic quiz'); checkAchievements();
      _orig.apply(this,arguments);
    };
  }
  function _patchSfTask(){
    var _orig=window.sfCompleteTask; if(!_orig){setTimeout(_patchSfTask,200);return;}
    window.sfCompleteTask=function(i,taskName){
      earnXP('sf_task_done',taskName||'Study task'); checkAchievements();
      _orig.apply(this,arguments);
    };
  }
  function _trackToolUse(toolName){
    var p=getProgress(); if(!p.toolsUsed)p.toolsUsed=[];
    if(p.toolsUsed.indexOf(toolName)===-1){p.toolsUsed.push(toolName);saveProgress(p);checkAchievements();}
  }
  function _patchTools(){
    ['sfToolTutor','sfToolFlashcards','sfToolQuiz','sfToolReviewer','sfToolMock','sfToolDiagnostic'].forEach(function(fn){
      var _orig=window[fn]; if(!_orig)return;
      window[fn]=function(){_trackToolUse(fn);return _orig.apply(this,arguments);};
    });
  }

  function _stopExamTimer(){
    if(window._examTimerInterval){clearInterval(window._examTimerInterval);window._examTimerInterval=null;}
    var t=document.getElementById('exam-sim-timer'); if(t)t.remove();
  }
  function _startExamTimer(minutes,onExpire){
    _stopExamTimer();
    var end=Date.now()+minutes*60000;
    var timerEl=document.createElement('div'); timerEl.id='exam-sim-timer';
    timerEl.style.cssText='position:sticky;top:0;z-index:300;background:rgba(245,158,11,.1);border-bottom:1px solid rgba(245,158,11,.2);padding:7px 16px;font-size:12px;font-weight:700;color:#f59e0b;font-family:inherit;display:flex;justify-content:space-between;align-items:center;';
    timerEl.innerHTML='<span>⏱ Exam Simulator</span><span id="exam-sim-countdown">'+minutes+':00</span>';
    var chatMsgs=document.getElementById('chat-messages');
    if(chatMsgs&&chatMsgs.parentElement)chatMsgs.parentElement.insertBefore(timerEl,chatMsgs);
    function tick(){
      var left=Math.max(0,end-Date.now());
      var m=Math.floor(left/60000),s=Math.floor((left%60000)/1000);
      var cd=document.getElementById('exam-sim-countdown');
      if(cd){cd.textContent=m+':'+(s<10?'0':'')+s;if(left<60000)cd.style.color='#ef4444';}
      if(left<=0){_stopExamTimer();if(typeof onExpire==='function')onExpire();}
    }
    tick(); window._examTimerInterval=setInterval(tick,1000);
  }
  function _injectExamModeButton(examRoot){
    if(examRoot.querySelector('.exam-sim-btn'))return;
    var btn=document.createElement('button'); btn.className='exam-sim-btn';
    btn.style.cssText='background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.2);color:#f59e0b;border-radius:8px;padding:5px 12px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;margin:8px 0;display:block;transition:background .15s;';
    btn.innerHTML='⏱ Start Exam Simulator';
    btn.onmouseenter=function(){btn.style.background='rgba(245,158,11,.2)';};
    btn.onmouseleave=function(){btn.style.background='rgba(245,158,11,.1)';};
    btn.onclick=function(){
      var qs=examRoot.querySelectorAll('.exam-question').length;
      var mins=Math.max(5,Math.round(qs*1.5));
      btn.remove();
      _startExamTimer(mins,function(){
        examRoot.querySelectorAll('.exam-option:not([disabled])').forEach(function(o){o.disabled=true;o.style.opacity='.4';});
        var msg=document.createElement('div');
        msg.style.cssText='background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.25);color:#ef4444;border-radius:8px;padding:10px 14px;font-size:13px;font-weight:600;margin-top:12px;font-family:inherit;';
        msg.textContent="⏱ Time's up! Unanswered questions have been locked.";
        examRoot.appendChild(msg);
      });
    };
    var hdr=examRoot.querySelector('.exam-header'); if(hdr)hdr.after(btn);
  }
  var _examObserver=new MutationObserver(function(muts){
    muts.forEach(function(m){m.addedNodes.forEach(function(node){
      if(node.nodeType!==1)return;
      var roots=node.classList&&node.classList.contains('exam-header')?[node.parentElement]:
        Array.prototype.slice.call((node.querySelectorAll?node.querySelectorAll('.exam-header'):[])).map(function(h){return h.parentElement;});
      roots.forEach(_injectExamModeButton);
    });});
  });

  function sm2Update(prev,quality){
    var d=prev||{},interval=d.interval!==undefined?d.interval:1,reps=d.repetitions!==undefined?d.repetitions:0,ef=d.easeFactor!==undefined?d.easeFactor:2.5;
    if(quality>=3){if(reps===0)interval=1;else if(reps===1)interval=6;else interval=Math.round(interval*ef);reps++;}
    else{interval=1;reps=0;}
    ef=Math.max(1.3,ef+0.1-(5-quality)*(0.08+(5-quality)*0.02));
    var due=new Date();due.setDate(due.getDate()+interval);
    return{interval:interval,repetitions:reps,easeFactor:ef,dueDate:due.toISOString()};
  }
  function _patchUpdateProgress(){
    var _orig=window.updateFlashcardProgress; if(!_orig){setTimeout(_patchUpdateProgress,300);return;}
    window.updateFlashcardProgress=function(topic,cardId,isCorrect){
      _orig.apply(this,arguments);
      var sr=getSRData(),key=topic+'::'+cardId,quality=isCorrect?4:2;
      sr[key]=sm2Update(sr[key],quality);saveSRData(sr);
      earnXP(isCorrect?'flashcard_correct':'flashcard_hard',topic);
      var p=getProgress();p.totalFlashcards=(p.totalFlashcards||0)+1;saveProgress(p);
      checkAchievements();
    };
  }

  function _injectWhyWrong(qEl){
    if(qEl.querySelector('.why-wrong-btn'))return;
    var expEl=qEl.querySelector('.exam-explanation'); if(!expEl)return;
    var qTextEl=qEl.querySelector('.exam-question-text'); if(!qTextEl)return;
    var whyBtn=document.createElement('button'); whyBtn.className='why-wrong-btn';
    whyBtn.style.cssText='background:rgba(99,102,241,.1);border:1px solid rgba(99,102,241,.2);color:#818cf8;border-radius:7px;padding:5px 12px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;margin-top:8px;transition:all .15s;display:block;';
    whyBtn.textContent='💡 Explain in depth';
    whyBtn.onclick=function(){
      whyBtn.textContent='⏳ Loading…';whyBtn.disabled=true;
      var qText=qTextEl.textContent||'',expText=expEl.textContent||'';
      fetch(API+'/ask',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({question:'I got this wrong on a quiz. Explain thoroughly:\n\nQuestion: '+qText+'\n\nExplanation given: '+expText+'\n\nGive a thorough breakdown with analogies and memory tips.',mode:'study',bookId:null})})
      .then(function(r){return r.json();})
      .then(function(data){
        var ans=(data&&(data.answer||data.error))||'Could not load.';
        var d=document.createElement('div');
        d.style.cssText='background:rgba(99,102,241,.07);border-left:3px solid #6366f1;padding:12px 14px;margin-top:10px;border-radius:0 8px 8px 0;font-size:13px;color:rgba(232,234,240,.8);line-height:1.65;';
        d.innerHTML=ans.replace(/\n/g,'<br>');expEl.after(d);whyBtn.remove();
      })
      .catch(function(){whyBtn.textContent='💡 Explain in depth';whyBtn.disabled=false;});
    };
    expEl.after(whyBtn);
  }
  var _whyWrongObserver=new MutationObserver(function(muts){
    muts.forEach(function(m){m.addedNodes.forEach(function(node){
      if(!node.querySelectorAll)return;
      node.querySelectorAll('.exam-wrong').forEach(function(w){var q=w.closest('.exam-question');if(q)_injectWhyWrong(q);});
    });});
  });

  function _patchPageRead(){
    var _orig=window.trackPageRead; if(!_orig){setTimeout(_patchPageRead,300);return;}
    window.trackPageRead=function(pageNum,pdfName){
      var p=getProgress();
      var pages=(p.pdfDocuments&&p.pdfDocuments[pdfName]&&p.pdfDocuments[pdfName].pagesRead)||[];
      var isNew=pages.indexOf(pageNum)===-1;
      _orig.apply(this,arguments);
      if(isNew){earnXP('page_read','Page '+pageNum);checkAchievements();}
    };
  }

  function _showSessionSummary(){
    var p=getProgress(); var today=new Date().toISOString().slice(0,10);
    var feed=(p.activityFeed||[]).filter(function(a){return new Date(a.ts).toISOString().slice(0,10)===today;});
    if(!feed.length)return;
    var totalXP=feed.reduce(function(s,a){return s+(a.xp||0);},0);
    var msgs=feed.filter(function(a){return a.type==='message_sent';}).length;
    var quizzes=feed.filter(function(a){return a.type==='quiz_completed'||a.type==='sf_quiz_completed';}).length;
    _ensureStyles();
    var t=document.createElement('div');
    t.style.cssText='position:fixed;bottom:80px;left:50%;transform:translateX(-50%);z-index:99999;background:rgba(10,12,22,.97);border:1px solid rgba(99,102,241,.3);color:#e8eaf0;padding:16px 22px;border-radius:16px;font-family:inherit;text-align:center;box-shadow:0 10px 40px rgba(0,0,0,.6);min-width:220px;animation:xpPop .4s ease both;pointer-events:none;';
    t.innerHTML='<div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:rgba(232,234,240,.35);margin-bottom:8px;">Today\'s session</div>'+
      '<div style="display:flex;gap:20px;justify-content:center;">'+
        '<div><div style="font-size:22px;font-weight:800;color:#818cf8;">'+totalXP+'</div><div style="font-size:10px;color:rgba(232,234,240,.4);">XP earned</div></div>'+
        '<div><div style="font-size:22px;font-weight:800;color:#10b981;">'+msgs+'</div><div style="font-size:10px;color:rgba(232,234,240,.4);">questions</div></div>'+
        (quizzes?'<div><div style="font-size:22px;font-weight:800;color:#f59e0b;">'+quizzes+'</div><div style="font-size:10px;color:rgba(232,234,240,.4);">quizzes</div></div>':'')+
      '</div>';
    document.body.appendChild(t);
    setTimeout(function(){t.style.animation='xpFade .4s ease forwards';setTimeout(function(){t.remove();},400);},4000);
  }

  function init(){
    _checkStreak();
    var chatEl=document.getElementById('chat-messages');
    if(chatEl){
      _examObserver.observe(chatEl,{childList:true,subtree:true});
      _whyWrongObserver.observe(chatEl,{childList:true,subtree:true});
    }
    setTimeout(_patchHandleAnswer,200);
    setTimeout(_patchSendMessage,300);
    setTimeout(_patchSfQuiz,400);
    setTimeout(_patchSfTask,400);
    setTimeout(_patchUpdateProgress,300);
    setTimeout(_patchPageRead,300);
    setTimeout(_patchTools,500);
    setTimeout(_renderXPBar,1500);
    setInterval(_renderXPBar,60000);
    // Expose so external code (clearProgress) can re-render the bar
    window._renderXPBar = _renderXPBar;
    var _origGoHome=window.goHome;
    if(typeof _origGoHome==='function'){
      window.goHome=function(){_showSessionSummary();return _origGoHome.apply(this,arguments);};
    }
  }

  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',init);}
  else{setTimeout(init,100);}
})();
