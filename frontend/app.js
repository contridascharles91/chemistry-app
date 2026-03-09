// ALL YOUR EXISTING JAVASCRIPT (from your original file)
  // Expose as window global so all script blocks can access it
  const API_URL = window.API_URL = (
    window.__API_URL__ ||
    'https://chunksai.up.railway.app'
  );

  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  let pdfDoc = null;
  let currentPdfName = null;
  let pageNum = 1;
  let pageRendering = false;
  let pageNumPending = null;
  let scale = 1.0;
  let outlineData = [];
  let currentPage = 1;
  let renderedPages = new Set();
  let isRendering = false;
  let currentStudyMode = 'study';

  const modeDescriptions = {
    study: {
      emoji: '🧠',
      name: 'Study Mode',
      desc: 'Simple explanations with examples'
    },
    exam: {
      emoji: '📘',
      name: 'Exam Mode',
      desc: 'Test your knowledge with questions'
    },
    practice: {
      emoji: '🧪',
      name: 'Practice Mode',
      desc: 'Solve problems step-by-step'
    },
    summary: {
      emoji: '📄',
      name: 'Summary Mode',
      desc: 'Quick review with key points'
    }
  };

  function setMode(mode) {
    currentStudyMode = mode;
    // Sync ni-mode-pill visuals so what user sees matches what's sent to backend
    document.querySelectorAll('.ni-mode-pill').forEach(p => {
      p.classList.toggle('active', p.getAttribute('data-mode') === mode);
    });
    // Sync legacy mode-select if it exists
    const sel = document.getElementById('mode-select');
    if (sel) sel.value = mode;
    // Show a clear warning banner when in non-study modes
    _showModeBanner(mode);
  }

  function _showModeBanner(mode) {
    let banner = document.getElementById('chunks-mode-banner');
    if (mode === 'study') {
      if (banner) banner.remove();
      return;
    }
    const labels = {
      exam:     { text: '📘 Exam Mode — every message generates quiz questions', color: '#6366f1', bg: 'rgba(99,102,241,.12)', border: 'rgba(99,102,241,.3)' },
      practice: { text: '🧪 Practice Mode — every message gives step-by-step problems', color: '#f59e0b', bg: 'rgba(245,158,11,.1)', border: 'rgba(245,158,11,.3)' },
      summary:  { text: '📄 Summary Mode — every message returns a structured summary', color: '#10b981', bg: 'rgba(16,185,129,.1)', border: 'rgba(16,185,129,.3)' },
    };
    const info = labels[mode];
    if (!info) return;
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'chunks-mode-banner';
      banner.style.cssText = `position:sticky;top:0;z-index:100;padding:7px 16px;display:flex;align-items:center;justify-content:space-between;gap:10px;font-family:'Inter','DM Sans',sans-serif;font-size:12px;font-weight:600;`;
    }
    banner.style.background = info.bg;
    banner.style.borderBottom = `1px solid ${info.border}`;
    banner.style.color = info.color;
    banner.innerHTML = `<span>${info.text}</span><button onclick="niSetMode(document.querySelector('.ni-mode-pill[data-mode=study]'),'study')" style="background:none;border:1px solid ${info.border};color:${info.color};border-radius:6px;padding:2px 8px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;">← Back to Study</button>`;
    const chatMsgs = document.getElementById('chat-messages');
    if (chatMsgs && chatMsgs.parentElement && !document.getElementById('chunks-mode-banner')) {
      chatMsgs.parentElement.insertBefore(banner, chatMsgs);
    }
  }

  // ==========================================
  // LIBRARY MODAL FUNCTIONS
  // ==========================================
  
  function openLibraryModal() {
    if (isFreeTier()) {
      showToast('🔒 Book Library is a Premium feature. Upgrade to unlock!');
      openPricingModal();
      return;
    }
    document.getElementById('library-modal').classList.add('active');
  }

  function closeLibraryModal() {
    document.getElementById('library-modal').classList.remove('active');
  }

  // Close modal when clicking outside
  document.addEventListener('click', function(event) {
    const modal = document.getElementById('library-modal');
    if (event.target === modal) {
      closeLibraryModal();
    }
  });

  // Book selection and configuration
  const bookLibrary = {
    zumdahl: {
      name: 'General Chemistry',
      author: 'Zumdahl & Zumdahl',
      edition: '9th Edition',
      chunksFile: 'zumdhal_chunks_with_embeddings.json',
      pdfFile: 'zumdahl_chemistry.pdf'
    },
    atkins: {
    name: 'Physical Chemistry',
    author: 'Atkins & de Paula',
    edition: '8th Edition',
    chunksFile: 'atkins_chunks_with_embeddings.json',
    pdfFile: 'atkins_physical_chemistry.pdf'
  },

    klein: {
    name: 'Organic Chemistry',
    author: 'David Klein',
    edition: '4th Edition',
    chunksFile: 'klein_chunks_with_embeddings.json',
    pdfFile: 'klein_organic_chemistry.pdf'
  },
    harris: {
      name: 'Quantitative Chemical Analysis',
      author: 'Daniel C. Harris',
      edition: '10th Edition',
      chunksFile: 'harris_chunks_with_embeddings.json',
      pdfFile: 'harris_quantitative_analysis.pdf'
    },
    berg: {
      name: 'Biochemistry',
      author: 'Berg, Tymoczko & Stryer',
      edition: '8th Edition',
      chunksFile: 'berg_chunks_with_embeddings.json',
      pdfFile: 'berg_biochemistry.pdf'
    },
    netter: {
      name: 'Atlas of Human Anatomy',
      author: 'Frank H. Netter',
      edition: '7th Edition',
      chunksFile: 'netter_chunks_with_embeddings.json',
      pdfFile: 'netter_atlas_human_anatomy.pdf'
    },
    anaphy2e: {
      name: 'Anatomy & Physiology',
      author: 'Patton & Thibodeau',
      edition: '2nd Edition',
      chunksFile: 'anaphy2e_chunks_with_embeddings.json',
      pdfFile: 'anaphy2e.pdf'
    }
  };

  async function selectBook(bookId) {
    const book = bookLibrary[bookId];
    if (!book) {
      _showToast('❌ Book not found!');
      return;
    }
    
    // Close the modal
    closeLibraryModal();
    
    // Show loading state
    const loadingMsg = `Loading ${book.name}...`;
    
    // Tell the server to load this book's chunks
    try {
      const response = await fetch(`${API_URL}/load-book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId: bookId })
      });
      
      const result = await response.json();
      
      if (result.success) {
        
        // Store selected book for auto-reload if server restarts
        localStorage.setItem('eightysix_current_book', bookId);
        
        // Persist to My Textbooks history
        const _bk = bookLibrary[bookId] || {};
        saveBookToHistory(bookId, _bk.name || bookId, _bk.author || '', null);
        renderChunksBooks();
        
        // Hide welcome screen and show main interface
        createNewChat();
        document.getElementById('welcome-screen').classList.add('hidden');
        document.getElementById('main-header').style.display = 'flex';
        document.getElementById('main-container').style.display = 'flex';
        // Exit general AI / fullscreen mode now that a book is loaded
        document.getElementById('main-container').classList.remove('chat-fullscreen');
        window._generalChatMode = false; try { sessionStorage.setItem('chunks_general_mode', '0'); } catch(e) {}
        
        // Now try to load the PDF file if it exists
        if (book.pdfFile) {
          await loadBookPDFFromServer(book.pdfFile, book.name);
        } else {
          // No PDF file, just show chunks are loaded
          _showToast(`✅ ${book.name} loaded — ${result.chunks_count} sections ready`);
        }
      } else {
        _showToast(`❌ Failed to load book: ${result.error}`);
      }
    } catch (error) {
      console.error('Error loading book:', error);
      _showToast(`❌ Error: ${error.message}`);
    }
  }

  async function loadBookPDFFromServer(pdfFileName, bookName) {
    if (isFreeTier()) {
      showToast('🔒 Book Library is a Premium feature. Upgrade to unlock!');
      openPricingModal();
      return;
    }
    try {
      // Get the current book ID from the bookLibrary
      let bookId = null;
      for (const [id, book] of Object.entries(bookLibrary)) {
        if (book.name === bookName) {
          bookId = id;
          break;
        }
      }
      
      if (!bookId) {
        throw new Error('Book ID not found');
      }
      
      // Load PDF from server endpoint
      const pdfPath = `${API_URL}/pdf/${bookId}`;

      // Check if cached first to show correct loading message
      let isFromCache = false;
      try {
        const cacheCheck = await caches.open('chunks-pdf-cache-v1');
        const hit = await cacheCheck.match(pdfPath);
        if (hit) isFromCache = true;
      } catch(e) {}
      // Show loading message with a reference to remove it later
      const loadingMsgId = 'pdf-loading-msg-' + Date.now();
      addChatMessage(isFromCache ? '⚡ Loading PDF from cache...' : '📥 Downloading PDF (this may take a moment the first time)...', 'ai', null, loadingMsgId);
      
      // -- PDF Cache via Cache API ------------------------------
      const CACHE_NAME = 'chunks-pdf-cache-v1';
      let pdfData = null;

      try {
        const cache = await caches.open(CACHE_NAME);
        const cachedResponse = await cache.match(pdfPath);

        if (cachedResponse) {
          const arrayBuffer = await cachedResponse.arrayBuffer();
          pdfData = new Uint8Array(arrayBuffer);
        } else {
          const response = await fetch(pdfPath);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          // Clone before consuming - one for cache, one for rendering
          const responseClone = response.clone();
          await cache.put(pdfPath, responseClone);
          const arrayBuffer = await response.arrayBuffer();
          pdfData = new Uint8Array(arrayBuffer);
        }
      } catch (cacheErr) {
        // Cache API unavailable (e.g. non-HTTPS) - fall back to direct fetch
      }

      const loadingTask = pdfData
        ? pdfjsLib.getDocument({ data: pdfData, disableAutoFetch: false, disableStream: false })
        : pdfjsLib.getDocument({ url: pdfPath, disableAutoFetch: false, disableStream: false, rangeChunkSize: 65536 });
      pdfDoc = await loadingTask.promise;
      currentPdfName = bookName;
      // Update chat input placeholder to reflect book context
      const chatInput = document.getElementById('chat-input');
      if (chatInput) {
        const shortName = bookName.length > 30 ? bookName.substring(0, 27) + '…' : bookName;
        chatInput.placeholder = `Ask about ${shortName}…`;
      }
      // #17: Update mobile book toggle label to show book is loaded
      const mobileLabel = document.getElementById('mobileBookToggleLabel');
      if (mobileLabel && !document.querySelector('.chat-panel.book-view-active')) {
        const mShort = bookName.length > 12 ? bookName.substring(0, 10) + '…' : bookName;
        mobileLabel.textContent = '📖 ' + mShort;
      }
      
      // Show close book button
      const closeBookBtn = document.getElementById('close-book-btn');
      if (closeBookBtn) closeBookBtn.style.display = '';
      // Show floating viewer close button
      const viewerCloseBtn = document.getElementById('pdf-viewer-close-btn');
      if (viewerCloseBtn) viewerCloseBtn.style.display = 'flex';

      // Update UI
      document.getElementById('page-total').textContent = pdfDoc.numPages;
      document.getElementById('page-input').max = pdfDoc.numPages;
      
      // Hide placeholder and setup viewer
      const viewer = document.getElementById('pdf-viewer');
      const placeholder = viewer.querySelector('.pdf-placeholder');
      if (placeholder) {
        placeholder.style.display = 'none';
      }
      
      viewer.innerHTML = '';
      renderedPages.clear();
      
      // Create pages container
      const pagesContainer = document.createElement('div');
      pagesContainer.id = 'pdf-pages-container';
      pagesContainer.style.cssText = 'display:flex; flex-direction:column; gap:20px; padding:20px; align-items:center; width:100%;';
      viewer.appendChild(pagesContainer);
      
      // Render first 5 pages in parallel for speed
      await Promise.all(
        Array.from({ length: Math.min(5, pdfDoc.numPages) }, (_, i) => renderPageScroll(i + 1))
      );
      
      // Remove the loading message now that PDF is ready
      const loadingMsg = document.getElementById(loadingMsgId);
      if (loadingMsg) loadingMsg.remove();

      // Show brief success toast instead of a permanent chat message
      showToast('✅ Textbook loaded! Scroll to read pages.');
      
      // Extract outline and generate thumbnails - defer so UI is unblocked first
      extractOutline();
      setTimeout(() => generateThumbnails(), 300);
      
      // Setup scroll handling
      viewer.addEventListener('scroll', handleScroll);
      updatePageInput();
      
      // Update progress tracking
      const progress = getProgressData();
      if (!progress.pdfDocuments[currentPdfName]) {
        progress.pdfDocuments[currentPdfName] = {
          pagesRead: [],
          totalPages: pdfDoc.numPages,
          questionsAsked: 0,
          lastAccessed: new Date().toISOString(),
          timeSpent: 0
        };
      }
      progress.pdfDocuments[currentPdfName].totalPages = pdfDoc.numPages;
      saveProgressData(progress);
      startStudySession();
      addRecentActivity('pdf_load', `Loaded ${currentPdfName}`, currentPdfName);
      
      // Update Books tab
      renderChunksBooks();
      
    } catch (error) {
      
      // Show a friendly message
      const pdfViewer = document.getElementById('pdf-viewer');
      pdfViewer.innerHTML = `
        <div class="pdf-placeholder">
          <h2 style="color:#aaa; margin-bottom:16px;">📚 ${bookName}</h2>
          <p style="color:#666; margin-bottom:12px;">Textbook content loaded successfully!</p>
          <p style="color:#888; font-size:14px;">PDF viewer not available, but you can still:</p>
          <ul style="color:#999; font-size:13px; text-align:left; max-width:300px; margin:16px auto;">
            <li style="margin:8px 0;">✅ Ask questions about the textbook</li>
            <li style="margin:8px 0;">✅ Generate flashcards</li>
            <li style="margin:8px 0;">✅ Get AI explanations</li>
          </ul>
        </div>
      `;
    }
  }

  function toggleSidebar() {
    document.getElementById('pdf-sidebar').classList.toggle('open');
  }

  function switchSidebarTab(tab) {
    document.querySelectorAll('.sidebar-tab').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    document.querySelectorAll('.sidebar-panel').forEach(panel => panel.classList.remove('active'));
    document.getElementById(`${tab}-panel`).classList.add('active');
  }

  function searchSidebar() {
    const search = document.getElementById('sidebar-search').value.toLowerCase();
    document.querySelectorAll('.outline-item').forEach(item => {
      const title = item.querySelector('.outline-title').textContent.toLowerCase();
      item.style.display = title.includes(search) ? 'flex' : 'none';
    });
  }

  async function extractOutline() {
    if (!pdfDoc) return;
    const outlinePanel = document.getElementById('outline-panel');
    outlinePanel.innerHTML = '<div class="outline-loading"><div class="loading-spinner"></div><div style="color:#888;">Extracting outline...</div></div>';
    try {
      const outline = await pdfDoc.getOutline();
      if (outline && outline.length > 0) {
        await buildOutlineFromPDF(outline);
      } else {
        outlinePanel.innerHTML = '<div class="outline-empty"><svg class="icon" width="18" height="18"><use href="#icon-books"/></svg> This PDF has no outline/bookmarks.<br><br>Try the Pages tab to navigate!</div>';
      }
    } catch (err) {
      outlinePanel.innerHTML = '<div class="outline-empty">⚠️ Could not extract outline</div>';
    }
  }

  async function buildOutlineFromPDF(outline, level = 1) {
    const outlinePanel = document.getElementById('outline-panel');
    outlineData = [];
    outlinePanel.innerHTML = '';
    await processOutlineItems(outline, level, outlinePanel);
    if (outlineData.length === 0) {
      outlinePanel.innerHTML = '<div class="outline-empty"><svg class="icon" width="18" height="18"><use href="#icon-books"/></svg> No valid outline items found</div>';
    }
    // Update Contents tab
    renderChunksContents();
  }

  async function processOutlineItems(items, level, container) {
    for (const item of items) {
      try {
        let pageNumber = null;
        if (item.dest) {
          if (typeof item.dest === 'string') {
            const dest = await pdfDoc.getDestination(item.dest);
            if (dest && dest[0]) {
              const pageIndex = await pdfDoc.getPageIndex(dest[0]);
              pageNumber = pageIndex + 1;
            }
          } else if (Array.isArray(item.dest) && item.dest[0]) {
            const pageIndex = await pdfDoc.getPageIndex(item.dest[0]);
            pageNumber = pageIndex + 1;
          }
        }
        if (pageNumber) {
          const itemDiv = document.createElement('div');
          itemDiv.className = `outline-item level-${level}`;
          itemDiv.onclick = () => {
            jumpToPage(pageNumber);
            if (window.innerWidth < 768) toggleSidebar();
          };
          itemDiv.innerHTML = `<div class="outline-title">${escapeHtml(item.title)}</div><div class="outline-page">${pageNumber}</div>`;
          container.appendChild(itemDiv);
          outlineData.push({ title: item.title, page: pageNumber, level: level });
        }
        if (item.items && item.items.length > 0 && level < 3) {
          await processOutlineItems(item.items, level + 1, container);
        }
      } catch (err) {}
    }
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  async function generateThumbnails() {
    if (!pdfDoc) return;
    const thumbnailsPanel = document.getElementById('thumbnails-panel');
    thumbnailsPanel.innerHTML = '<div class="outline-loading"><div class="loading-spinner"></div><div style="color:#888;">Generating thumbnails...</div></div>';
    const grid = document.createElement('div');
    grid.className = 'thumbnails-grid';
    const maxThumbs = Math.min(20, pdfDoc.numPages);
    const BATCH = 5; // render 5 thumbnails at a time in parallel
    for (let i = 1; i <= maxThumbs; i += BATCH) {
      const batch = Array.from({ length: Math.min(BATCH, maxThumbs - i + 1) }, (_, j) => createThumbnail(i + j));
      const thumbItems = await Promise.all(batch);
      thumbItems.forEach(item => grid.appendChild(item));
    }
    thumbnailsPanel.innerHTML = '';
    thumbnailsPanel.appendChild(grid);
    if (pdfDoc.numPages > maxThumbs) {
      const loadMore = document.createElement('div');
      loadMore.style.cssText = 'text-align:center; padding:20px; color:#888; cursor:pointer;';
      loadMore.textContent = `+ Load ${pdfDoc.numPages - maxThumbs} more pages`;
      loadMore.onclick = () => loadMoreThumbnails(maxThumbs + 1, grid, loadMore);
      thumbnailsPanel.appendChild(loadMore);
    }
  }

  async function createThumbnail(pageNumber) {
    const page = await pdfDoc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 0.3 });
    const canvas = document.createElement('canvas');
    canvas.className = 'thumbnail-canvas';
    const context = canvas.getContext('2d', { willReadFrequently: true });
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    await page.render({ canvasContext: context, viewport: viewport }).promise;
    const thumbItem = document.createElement('div');
    thumbItem.className = 'thumbnail-item';
    if (pageNumber === pageNum) thumbItem.classList.add('active');
    thumbItem.onclick = () => {
      jumpToPage(pageNumber);
      document.querySelectorAll('.thumbnail-item').forEach(t => t.classList.remove('active'));
      thumbItem.classList.add('active');
      if (window.innerWidth < 768) toggleSidebar();
    };
    const label = document.createElement('div');
    label.className = 'thumbnail-label';
    label.textContent = `Page ${pageNumber}`;
    thumbItem.appendChild(canvas);
    thumbItem.appendChild(label);
    return thumbItem;
  }

  async function loadMoreThumbnails(startPage, grid, loadMoreBtn) {
    loadMoreBtn.textContent = 'Loading...';
    const endPage = Math.min(startPage + 20, pdfDoc.numPages);
    const BATCH = 5;
    for (let i = startPage; i <= endPage; i += BATCH) {
      const batch = Array.from({ length: Math.min(BATCH, endPage - i + 1) }, (_, j) => createThumbnail(i + j));
      const thumbItems = await Promise.all(batch);
      thumbItems.forEach(item => grid.appendChild(item));
    }
    if (endPage < pdfDoc.numPages) {
      loadMoreBtn.textContent = `+ Load ${pdfDoc.numPages - endPage} more pages`;
      loadMoreBtn.onclick = () => loadMoreThumbnails(endPage + 1, grid, loadMoreBtn);
    } else {
      loadMoreBtn.remove();
    }
  }

  function saveChatHistory() {
    let messages = [];
    document.querySelectorAll('.message').forEach(msg => {
      if (!msg.querySelector('.typing-indicator')) {
        const bubble = msg.querySelector('.message-bubble');
        if (bubble) {
          messages.push({
            sender: msg.classList.contains('user') ? 'user' : 'ai',
            html: bubble.innerHTML
          });
        }
      }
    });

    // Guard against localStorage quota (~5MB limit).
    // Keep trimming oldest messages until it fits or we have nothing left.
    const _trySave = (msgs) => {
      try {
        localStorage.setItem('eightysix_chat_history', JSON.stringify(msgs));
        return true;
      } catch(e) {
        return false; // QuotaExceededError
      }
    };

    while (messages.length > 0) {
      if (_trySave(messages)) return;
      // Remove oldest 5 messages and retry
      messages = messages.slice(5);
    }
    // If even empty fails (extremely unlikely), silently ignore
    try { localStorage.removeItem('eightysix_chat_history'); } catch(e) {}
  }

  function loadChatHistory() {
    try {
      const saved = localStorage.getItem('eightysix_chat_history');
      if (!saved) return;
      const messages = JSON.parse(saved);
      const chat = document.getElementById('chat-messages');
      const typing = document.getElementById('typing-indicator');
      chat.innerHTML = '';
      chat.appendChild(typing);
      messages.forEach(msg => {
        const div = document.createElement('div');
        div.className = `message ${msg.sender}`;
        const bubble = document.createElement('div');
        bubble.className = 'message-bubble';
        bubble.innerHTML = msg.html;
        const pageRefs = bubble.querySelectorAll('.page-reference');
        pageRefs.forEach(ref => {
          const pageMatch = ref.textContent.match(/\d+/);
          if (pageMatch) {
            ref.onclick = () => jumpToPage(parseInt(pageMatch[0]));
          }
        });
        div.appendChild(bubble);
        chat.insertBefore(div, typing);
      });
      if (getPrefs().autoscroll !== false) chat.scrollTop = chat.scrollHeight;
      if (getPrefs().mathjax !== false && typeof MathJax !== 'undefined') {
        setTimeout(() => renderMath(chat), 500);
      }
    } catch(e) {
      // Corrupted history — clear it and start fresh
      try { localStorage.removeItem('eightysix_chat_history'); } catch(e2) {}
    }
  }

  async function loadPDF(event) {
    // Free tier: PDF upload is a Premium feature
    if (isFreeTier()) {
      showToast('🔒 PDF Textbook Upload is a Premium feature. Upgrade to unlock!');
      openPricingModal();
      event.target.value = '';
      return;
    }
    const file = event.target.files[0];
    if (!file || file.type !== 'application/pdf') {
      _showToast('📄 Please select a PDF file first!');
      return;
    }

    // TRANSITION FROM WELCOME TO SPLIT-SCREEN
    createNewChat();
    document.getElementById('welcome-screen').classList.add('hidden');
    document.getElementById('main-header').classList.add('active');
    document.getElementById('main-container').classList.add('active');

    const reader = new FileReader();
    reader.onload = async function() {
      const typedarray = new Uint8Array(this.result);
      // Cache the PDF in IndexedDB so it survives refresh
      try {
        await idbSavePDF(file.name, this.result);
      } catch(e) { console.warn('PDF cache save failed:', e); }
      pdfDoc = await pdfjsLib.getDocument(typedarray).promise;
      document.getElementById('page-total').textContent = pdfDoc.numPages;
      document.querySelector('.pdf-placeholder').style.display = 'none';
      const viewer = document.getElementById('pdf-viewer');
      viewer.innerHTML = '';
      renderedPages.clear();
      const pagesContainer = document.createElement('div');
      pagesContainer.id = 'pdf-pages-container';
      pagesContainer.style.cssText = 'display:flex; flex-direction:column; gap:20px; padding:20px; align-items:center; width:100%;';
      viewer.appendChild(pagesContainer);
      for (let i = 1; i <= Math.min(3, pdfDoc.numPages); i++) {
        await renderPageScroll(i);
      }
      addChatMessage('<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: inline-block; vertical-align: middle; margin-right: 6px;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>Textbook loaded! Scroll to read pages.', 'ai');
      
      // Track PDF load and start study session
      currentPdfName = file.name.replace('.pdf', '');
      // Update chat input placeholder
      const _uploadInput = document.getElementById('chat-input');
      if (_uploadInput) {
        const _sn = currentPdfName.length > 30 ? currentPdfName.substring(0, 27) + '…' : currentPdfName;
        _uploadInput.placeholder = `Ask about ${_sn}…`;
      }
      // Save to My Textbooks
      const _pdfBookId = 'local_' + currentPdfName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      localStorage.setItem('eightysix_current_book', _pdfBookId);
      saveBookToHistory(_pdfBookId, currentPdfName, 'Local Upload', pdfDoc.numPages);
      renderChunksBooks();
      const progress = getProgressData();
      if (!progress.pdfDocuments[currentPdfName]) {
        progress.pdfDocuments[currentPdfName] = {
          pagesRead: [],  // Use array instead of Set
          totalPages: pdfDoc.numPages,
          questionsAsked: 0,
          lastAccessed: new Date().toISOString(),
          timeSpent: 0
        };
        saveProgressData(progress);
      }
      progress.pdfDocuments[currentPdfName].totalPages = pdfDoc.numPages;
      saveProgressData(progress);
      startStudySession();
      addRecentActivity('pdf_load', `Loaded ${currentPdfName}`, currentPdfName);
      
      extractOutline();
      generateThumbnails();
      viewer.addEventListener('scroll', handleScroll);
      updatePageInput();

      // Update Books tab
      renderChunksBooks();
    };
    reader.readAsArrayBuffer(file);
  }

  async function renderPageScroll(pageNumber) {
    if (renderedPages.has(pageNumber) || !pdfDoc) return;
    if (pageNumber < 1 || pageNumber > pdfDoc.numPages) return;
    renderedPages.add(pageNumber);
    const page = await pdfDoc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: scale });
    const canvas = document.createElement('canvas');
    canvas.className = 'pdf-page-canvas';
    canvas.dataset.pageNumber = pageNumber;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    const pageContainer = document.createElement('div');
    pageContainer.className = 'pdf-page-container';
    pageContainer.dataset.pageNumber = pageNumber;
    pageContainer.style.cssText = 'position:relative; box-shadow:0 4px 20px rgba(0,0,0,0.5); background:#fff;';
    const pageLabel = document.createElement('div');
    pageLabel.textContent = `Page ${pageNumber}`;
    pageLabel.style.cssText = 'position:absolute; top:8px; right:8px; background:rgba(0,0,0,0.7); color:white; padding:4px 12px; border-radius:4px; font-size:12px; font-weight:600; z-index:10;';
    pageContainer.appendChild(pageLabel);
    pageContainer.appendChild(canvas);
    const container = document.getElementById('pdf-pages-container');
    const existingPages = Array.from(container.children);
    let inserted = false;
    for (let i = 0; i < existingPages.length; i++) {
      const existingPageNum = parseInt(existingPages[i].dataset.pageNumber);
      if (existingPageNum > pageNumber) {
        container.insertBefore(pageContainer, existingPages[i]);
        inserted = true;
        break;
      }
    }
    if (!inserted) {
      container.appendChild(pageContainer);
    }
    await page.render({ canvasContext: context, viewport: viewport }).promise;

    // Build text layer for search highlighting
    try {
      const textContent = await page.getTextContent();
      const textLayerDiv = document.createElement('div');
      textLayerDiv.className = 'pdf-text-layer';
      textLayerDiv.dataset.pageNumber = pageNumber;
      // Enable pointer-events so text is selectable
      textLayerDiv.style.cssText = `position:absolute;top:0;left:0;width:${viewport.width}px;height:${viewport.height}px;overflow:hidden;z-index:5;`;
      textContent.items.forEach(item => {
        if (!item.str.trim()) return;
        const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
        const span = document.createElement('span');
        span.textContent = item.str;
        span.dataset.text = item.str.toLowerCase();
        span.style.cssText = `position:absolute;left:${tx[4]}px;top:${tx[5] - Math.abs(tx[0])}px;font-size:${Math.abs(tx[0])}px;font-family:sans-serif;color:transparent;white-space:pre;cursor:text;user-select:text;`;
        textLayerDiv.appendChild(span);
      });
      pageContainer.appendChild(textLayerDiv);
      // Apply any pending highlight
      if (window._pendingHighlight) highlightTextOnPage(pageNumber, window._pendingHighlight);
    } catch(e) { console.warn('Text layer error:', e); }

    // Track page read - with error handling
    try {
      if (currentPdfName) {
        trackPageRead(pageNumber, currentPdfName);
        // Refresh sidebar if it's open
        if (currentChunksTab === 'progress') {
          renderSidebarProgress();
        }
      } else {
      }
    } catch (error) {
      console.error('Page tracking error:', error);
      // Don't let tracking errors break PDF rendering
    }
  }

  // #14: Summarize current page button
  window.summarizeCurrentPage = async function() {
    const page = currentPage || pageNum || 1;
    const input = document.getElementById('chat-input');
    if (!input) return;

    // Try to extract visible text from the current page for a smarter prompt
    let pageContext = '';
    try {
      const textLayer = document.querySelector(`.pdf-text-layer[data-page-number="${page}"]`);
      if (textLayer) {
        const rawText = textLayer.innerText || textLayer.textContent || '';
        // Get first ~400 chars of page text as context for the AI
        pageContext = rawText.replace(/\s+/g, ' ').trim().slice(0, 400);
      }
    } catch(e) {}

    if (pageContext) {
      input.value = `Summarize page ${page} for me. The page appears to contain content about: "${pageContext.slice(0, 120)}…" — please focus your summary on what is actually on this page, covering the main concepts, key terms, and important details.`;
    } else {
      input.value = `Summarize page ${page} for me. Cover the main concepts, key terms, and important details found on this page.`;
    }
    sendMessage();
  };

  async function jumpToPage(pageNumber) {
    if (!pdfDoc || pageNumber < 1 || pageNumber > pdfDoc.numPages) return;
    if (!renderedPages.has(pageNumber)) {
      await renderPageScroll(pageNumber);
    }
    // Wait for DOM to settle
    await new Promise(r => setTimeout(r, 100));
    const pageContainer = document.querySelector(`.pdf-page-container[data-page-number="${pageNumber}"]`);
    if (pageContainer) {
      pageContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
      currentPage = pageNumber;
      updatePageInput();
    }
  }

  async function jumpToPageWithHighlight(pageNumber, searchTerm, sourceText, doHighlight = true) {
    if (!pdfDoc || pageNumber < 1 || pageNumber > pdfDoc.numPages) return;
    // Clear previous highlights and pending state
    clearHighlights();
    window._pendingHighlight = null;

    const stopwords = new Set(['what','is','the','a','an','in','on','at','to','for','of','and','or','how','why','when','where','which','who','does','did','can','be','are','was','has','have','this','that','with','from','its','give','me','tell','about','explain','define','describe','show','list','find']);

    // Helper to extract best keyword from text
    const extractKeyword = (text) => {
      if (!text) return null;
      const words = text.toLowerCase()
        .replace(/[^a-z0-9 ]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2 && !stopwords.has(w));
      // Prefer longer, more specific words (likely to be the topic)
      words.sort((a, b) => b.length - a.length);
      return words[0] || null;
    };

    // Prioritize: user query > source text excerpt
    const keyword = extractKeyword(searchTerm) || extractKeyword(sourceText);

    // Only set pending highlight if highlight is enabled
    if (keyword && doHighlight) window._pendingHighlight = keyword;

    if (!renderedPages.has(pageNumber)) {
      await renderPageScroll(pageNumber);
    }
    // Wait for DOM to settle
    await new Promise(r => setTimeout(r, 150));

    const pageContainer = document.querySelector(`.pdf-page-container[data-page-number="${pageNumber}"]`);
    if (pageContainer) {
      pageContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
      currentPage = pageNumber;
      updatePageInput();
    }

    if (keyword && doHighlight) {
      await new Promise(r => setTimeout(r, 200));
      highlightTextOnPage(pageNumber, keyword);
    }
  }

  function highlightTextOnPage(pageNumber, term) {
    if (!term) return;
    const layer = document.querySelector(`.pdf-text-layer[data-page-number="${pageNumber}"]`);
    if (!layer) {
      window._pendingHighlight = term;
      return;
    }
    const lowerTerm = term.toLowerCase();
    let firstMatch = null;
    layer.querySelectorAll('span').forEach(span => {
      const spanText = (span.dataset.text || span.textContent || '').toLowerCase();
      if (spanText && spanText.includes(lowerTerm)) {
        span.style.background = 'rgba(255, 213, 0, 0.65)';
        span.style.borderRadius = '2px';
        span.style.outline = '2px solid rgba(255, 180, 0, 0.8)';
        span.classList.add('pdf-highlight');
        if (!firstMatch) firstMatch = span;
      }
    });
    // Scroll to first match after a tick
    if (firstMatch) {
      setTimeout(() => firstMatch.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
      window._pendingHighlight = null;
    }
  }

  function clearHighlights() {
    document.querySelectorAll('.pdf-highlight').forEach(el => {
      el.style.background = 'transparent';
      el.style.boxShadow = 'none';
      el.style.outline = 'none';
      el.classList.remove('pdf-highlight');
    });
    window._pendingHighlight = null;
  }

  // #20: PDF text selection → "Ask AI about this" floating button
  (function setupPDFTextSelection() {
    // Create floating tooltip element
    const tooltip = document.createElement('div');
    tooltip.id = 'pdf-ask-ai-tooltip';
    tooltip.innerHTML = `
      <button id="pdf-ask-ai-btn" style="display:flex;align-items:center;gap:6px;background:linear-gradient(135deg,#667eea,#764ba2);color:white;border:none;border-radius:20px;padding:7px 14px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;box-shadow:0 4px 16px rgba(102,126,234,0.5);white-space:nowrap;">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
        Ask AI about this
      </button>`;
    tooltip.style.cssText = 'position:fixed;z-index:99999;display:none;pointer-events:all;animation:pmPop 0.15s ease;';
    document.body.appendChild(tooltip);

    document.addEventListener('mouseup', function(e) {
      const pdfViewer = document.getElementById('pdf-viewer');
      if (!pdfViewer) return;

      setTimeout(() => {
        const sel = window.getSelection();
        const selectedText = sel ? sel.toString().trim() : '';

        if (selectedText.length > 10 && selectedText.length < 2000) {
          // Check if selection is within PDF viewer
          const range = sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
          if (!range) return;
          const container = range.commonAncestorContainer;
          if (!pdfViewer.contains(container)) return;

          const rect = range.getBoundingClientRect();
          tooltip.style.display = 'block';
          tooltip.style.left = Math.max(8, rect.left + rect.width / 2 - 80) + 'px';
          tooltip.style.top = (rect.top - 48 + window.scrollY) + 'px';

          const btn = document.getElementById('pdf-ask-ai-btn');
          if (btn) {
            btn.onclick = function() {
              const input = document.getElementById('chat-input');
              if (input) {
                input.value = `Explain this to me: "${selectedText.substring(0, 300)}"`;
                tooltip.style.display = 'none';
                sel.removeAllRanges();
                sendMessage();
              }
            };
          }
        } else {
          tooltip.style.display = 'none';
        }
      }, 10);
    });

    document.addEventListener('mousedown', function(e) {
      if (!e.target.closest('#pdf-ask-ai-tooltip')) {
        tooltip.style.display = 'none';
      }
    });
  })();

  function handleScroll() {
    if (isRendering || !pdfDoc) return;
    const viewer = document.getElementById('pdf-viewer');
    const scrollTop = viewer.scrollTop;
    const scrollHeight = viewer.scrollHeight;
    const clientHeight = viewer.clientHeight;
    updateCurrentPage();
    if (scrollTop + clientHeight > scrollHeight - 1000) {
      loadMorePages();
    }
  }

  function updateCurrentPage() {
    const viewer = document.getElementById('pdf-viewer');
    const viewerTop = viewer.scrollTop;
    const viewerMiddle = viewerTop + viewer.clientHeight / 2;
    const pageContainers = document.querySelectorAll('.pdf-page-container');
    let closestPage = 1;
    let closestDistance = Infinity;
    pageContainers.forEach(container => {
      const rect = container.getBoundingClientRect();
      const containerTop = container.offsetTop;
      const containerMiddle = containerTop + rect.height / 2;
      const distance = Math.abs(containerMiddle - viewerMiddle);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestPage = parseInt(container.dataset.pageNumber);
      }
    });
    if (closestPage !== currentPage) {
      currentPage = closestPage;
      updatePageInput();
      document.querySelectorAll('.thumbnail-item').forEach((thumb, idx) => {
        thumb.classList.toggle('active', idx + 1 === currentPage);
      });
    }
  }

  async function loadMorePages() {
    if (isRendering || !pdfDoc) return;
    isRendering = true;
    let maxRendered = Math.max(...Array.from(renderedPages));
    for (let i = maxRendered + 1; i <= Math.min(maxRendered + 3, pdfDoc.numPages); i++) {
      await renderPageScroll(i);
    }
    isRendering = false;
  }

  function renderMath(element) {
    if (typeof MathJax !== 'undefined' && MathJax.typesetPromise) {
      MathJax.typesetPromise([element]).catch(err => console.log('MathJax error'));
    }
  }

  async function sendMessage() {
    const input = document.getElementById('chat-input');
    const msg = input.value.trim();
    if (!msg) return;
    input.value = '';
    if (typeof updateSendVoiceBtn === 'function') updateSendVoiceBtn();
    // Strip feature tokens so they don't appear in the chat bubble
    const displayMsg = msg.replace(/\[WEB_SEARCH_ENABLED\]|\[THINKING_MODE\]|\[DEEP_THINKING_MODE\]/g, '').trim();
    // Skip adding user bubble if this is a regeneration (user msg already in DOM)
    if (!window._regenTargetMsg) {
      addChatMessage(displayMsg, 'user');
    }
    // Save immediately so user message appears in sidebar right away.
    // If this is the first message, promote the chat from pending (_empty) to saved.
    if (chatSessions[currentChatId] && chatSessions[currentChatId]._empty) {
      delete chatSessions[currentChatId]._empty;
      displayChatHistory();
    }
    saveCurrentChat();
    try {
      const isCommand = msg.toLowerCase() === 'clear session' || 
                        ['progress', 'stats', 'statistics', 'dashboard'].some(k => msg.toLowerCase().includes(k)) ||
                        ['flashcard', 'flash card', 'quiz me'].some(k => msg.toLowerCase().includes(k));
      if (!isCommand && currentPdfName) {
        trackQuestion(msg, currentPdfName);
      }
    } catch (error) {
      console.error('Tracking error:', error);
      // Don't let tracking errors break chat functionality
    }
    
    if (msg.toLowerCase() === 'clear session') {
      // Only clear session/chat keys, not user auth or settings
      const keysToKeep = ['chunks_user', 'chunks_guest', 'chunks_theme', 'chunks_split_pct'];
      const savedValues = {};
      keysToKeep.forEach(k => { const v = localStorage.getItem(k); if (v !== null) savedValues[k] = v; });
      localStorage.clear();
      Object.entries(savedValues).forEach(([k, v]) => localStorage.setItem(k, v));
      location.reload();
      return;
    }
    const flashcardKeywords = ['flashcard', 'flash card', 'quiz me', 'study cards'];
    const isFlashcardRequest = flashcardKeywords.some(k => msg.toLowerCase().includes(k));
    if (isFlashcardRequest) {
      if (isFreeTier()) {
        addChatMessage('🔒 Flashcards are a <strong>Pro & Ultra</strong> feature. <a href="#" onclick="openPricingModal()" style="color:#667eea;text-decoration:underline;">Upgrade to unlock</a>!', 'ai');
        typing && typing.classList.remove('active');
        return;
      }
      generateFlashcardsInChat(extractTopic(msg));
      return;
    }
    const progressKeywords = ['progress', 'stats', 'statistics', 'my progress', 'show progress', 'view stats', 'study stats', 'dashboard'];
    const isProgressRequest = progressKeywords.some(k => msg.toLowerCase().includes(k));
    if (isProgressRequest) {
      showProgressDashboard();
      return;
    }
    // Open periodic table directly if user asks to show it
    const ptDirectKeywords = ['show periodic table', 'open periodic table', 'periodic table please', 'display periodic table', 'view periodic table', 'show me the periodic table', 'pull up periodic table', 'show the periodic table'];
    const isPTDirectRequest = ptDirectKeywords.some(k => msg.toLowerCase().includes(k));
    if (isPTDirectRequest) {
      if (isFreeTier()) {
        addChatMessage('🔒 Periodic Table is a <strong>Premium</strong> feature. <a href="#" onclick="openPricingModal()" style="color:#667eea;text-decoration:underline;">Upgrade to unlock</a>!', 'ai');
        return;
      }
      addChatMessage('Here\'s the Periodic Table of Elements! 🔬', 'ai');
      openPT();
      return;
    }
    if (!pdfDoc) {
    }
    const typing = document.getElementById('typing-indicator');
    // Smart indicator: tell it what mode + what the user asked
    if (typeof window.setTypingContext === 'function') {
      window.setTypingContext(
        typeof currentStudyMode !== 'undefined' ? currentStudyMode : null,
        displayMsg
      );
    }
    typing.classList.add('active');
    const sendBtn = document.getElementById('send-btn');
    sendBtn.disabled = true;
    
    try {
      // Guest mode: limit to 10 messages
      if (isGuestMode) {
        const msgCount = document.querySelectorAll('.message.user').length;
        if (msgCount >= 10) {
          addChatMessage('⚠️ You\'ve reached the 10 message limit for guest mode. Please <a href="#" onclick="showAuthScreen()" style="color:#667eea;text-decoration:underline;">sign in with Google</a> to continue.', 'ai');
          typing.classList.remove('active');
          return;
        }
      }

      // Free tier: limit to 20 AI messages per day
      if (freeTierMessageLimitReached()) {
        addChatMessage('⚠️ You\'ve reached your 20 free messages for today. <a href="#" onclick="openPricingModal()" style="color:#667eea;text-decoration:underline;">Upgrade to Premium</a> for unlimited access.', 'ai');
        typing.classList.remove('active');
        return;
      }
      if (isFreeTier()) incrementFreeTierMessageCount();
      window._lastFailedMsg = msg; // store for potential retry
      
      // Build conversation history (last 6 prior turns — exclude current message just added)
      const chatHistory = [];
      const chatMsgsEl = document.getElementById('chat-messages');
      if (chatMsgsEl) {
        const allMsgs = Array.from(chatMsgsEl.querySelectorAll('.message:not(.typing-indicator)'));
        const recent = allMsgs.slice(0, -1).slice(-6);
        recent.forEach(msgEl => {
          const bubble = msgEl.querySelector('.message-bubble');
          if (!bubble) return;
          const role = msgEl.classList.contains('user') ? 'user' : 'assistant';
          const tmp = document.createElement('div'); tmp.innerHTML = bubble.innerHTML;
          const text = tmp.textContent.trim();
          if (text && text.length > 2) chatHistory.push({ role, content: text.substring(0, 1000) });
        });
      }

      // Get JWT for server-side tier verification (don't trust client-sent user_tier alone)
      let _authToken = '';
      try {
        const _sb = await getSupabase();
        const { data: { session } } = await _sb.auth.getSession();
        if (session && session.access_token) _authToken = session.access_token;
      } catch(e) {}

      const res = await fetch(`${API_URL}/ask`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...((_authToken) ? { 'Authorization': 'Bearer ' + _authToken } : {})
        },
        body: JSON.stringify({
          question: msg,
          mode: currentStudyMode,
          complexity: currentComplexity,
          bookId: window._generalChatMode ? null : (localStorage.getItem('eightysix_current_book') || 'zumdahl'),
          general_mode: !!window._generalChatMode,
          history: chatHistory,
          user_memory: getAIMemoryString(),
          web_search: !!window._webSearchEnabled,
          user_tier: isFreeTier() ? 'free' : 'paid'
        })
      });
      
      const data = await res.json();
      
      if (data.success) {

        // Check if the AI model itself returned an error string
        const answerText = data.answer || data.raw || '';
        if (answerText.startsWith('Error:')) {
          const rawErr = answerText.replace(/^Error:\s*/i, '');
          let userMsg = '';
          if (rawErr.includes('429') || rawErr.toLowerCase().includes('rate limit')) {
            userMsg = '⏳ The AI model is rate-limited right now. Please wait a moment and try again.';
          } else if (rawErr.toLowerCase().includes('timed out') || rawErr.toLowerCase().includes('timeout')) {
            userMsg = '⏱️ The AI timed out. Try a shorter message or try again.';
          } else if (rawErr.toLowerCase().includes('no choices') || rawErr.toLowerCase().includes('model returned')) {
            userMsg = '🤖 The free AI model returned an empty response — it may be overloaded. Try again in a few seconds.';
          } else {
            userMsg = `❌ AI error: ${rawErr}`;
          }
          addChatMessage(userMsg, 'ai');
          return;
        }

        // Show thinking mode indicator if active
        if (window._thinkingMode) {
          const thinkLabel = window._thinkingMode === 'deep'
            ? '<span style="font-size:11px;font-weight:700;color:#fda4af;background:rgba(251,113,133,0.12);border:1px solid rgba(251,113,133,0.25);border-radius:12px;padding:2px 8px;margin-bottom:6px;display:inline-block;">🔮 Deep thinking</span><br>'
            : '<span style="font-size:11px;font-weight:700;color:#c4b5fd;background:rgba(167,139,250,0.12);border:1px solid rgba(167,139,250,0.25);border-radius:12px;padding:2px 8px;margin-bottom:6px;display:inline-block;">💭 Thinking</span><br>';
          // Prepend to answer for display
          if (data.answer) data.answer = thinkLabel + data.answer;
        }

        // Show web search indicator
        if (data.web_search) {
          const wsLabel = '<span style="font-size:11px;font-weight:700;color:#6ee7b7;background:rgba(110,231,183,0.1);border:1px solid rgba(110,231,183,0.25);border-radius:12px;padding:2px 10px;margin-bottom:8px;display:inline-flex;align-items:center;gap:4px;"><svg width=\'10\' height=\'10\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'currentColor\' stroke-width=\'2.5\'><circle cx=\'11\' cy=\'11\' r=\'8\'/><path d=\'m21 21-4.35-4.35\'/></svg> Web search</span><br>';
          if (data.answer) data.answer = wsLabel + data.answer;
        }

        if (data.mode === 'exam') {
          // -- EXAM MODE: render interactive MCQ cards ----------------------
          renderExamQuestions(data.questions || [], data.raw || '');
        } else if (data.mode === 'practice') {
          // -- PRACTICE MODE: step-by-step problem solving ------------------
          renderPracticeResponse(data.answer, data.source);
        } else if (data.mode === 'summary') {
          // -- SUMMARY MODE: structured topic summary -----------------------
          renderSummaryResponse(data.answer, data.source);
        } else {
          // -- STUDY MODE (default) -----------------------------------------
          // If this is a regeneration, push into the existing AI message's version history
          if (window._regenTargetMsg && window._regenTargetMsg.isConnected) {
            const target = window._regenTargetMsg;
            window._regenTargetMsg = null;
            const newHtml = formatAIResponse(data.answer || '(No response)');
            target._regenVersions.push({ html: newHtml, source: data.source });
            target._regenIdx = target._regenVersions.length - 1;
            // Update the ai-content div if present, else fall back to full bubble
            const targetContent = target.querySelector('.ai-content') || target.querySelector('.message-bubble');
            if (targetContent) targetContent.innerHTML = newHtml;
            // Update nav label
            const navLabel = target.querySelector('.regen-nav-label');
            if (navLabel) {
              navLabel.textContent = `${target._regenIdx + 1}/${target._regenVersions.length}`;
              const prevBtn = target.querySelector('.regen-nav-btn:first-child');
              if (prevBtn) prevBtn.style.opacity = target._regenIdx === 0 ? '0.3' : '1';
              target.querySelector('.regen-nav').style.display = 'flex';
            }
          } else {
            window._regenTargetMsg = null;
            addChatMessage(data.answer || '(No response)', 'ai', data.source, null, data.sources || [], data.web_citations || []);
          }
        }

        // Show periodic table button and auto-open if response mentions periodic table
        if (!isFreeTier() && detectPeriodicTableMention(data.answer)) {
          const lastMsg = document.querySelector('#chat-messages .message.ai:last-of-type .message-bubble');
          if (lastMsg && !lastMsg.querySelector('.pt-trigger-btn')) {
            const ptBtn = document.createElement('button');
            ptBtn.className = 'pt-trigger-btn';
            ptBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg> 🔬 View Periodic Table`;
            ptBtn.onclick = () => openPT();
            lastMsg.appendChild(ptBtn);
          }
          // Auto-open the periodic table
          openPT();
        }
        
        if (data.complexity_used) {
        }

        // Auto-detect molecule from user's question - create bubble + inline card + open modal
        const detectedMolecule = detectMoleculeFromText(msg);
        if (detectedMolecule) {
          // Add inline molecule card to chat
          createMoleculeChatCard(detectedMolecule);
          // Create floating bubble (draggable)
          createMoleculeBubble(detectedMolecule, 0);
        }
        
        if (data.molecules && data.molecules.length > 0) {
          data.molecules.forEach((molecule, index) => {
            setTimeout(() => {
              createMoleculeBubble(molecule, index);
            }, index * 300);
          });
        }
        if (data.source && data.source.page) {
          const _s = getSettings();
          if (_s.autojump === true || _s.autojump === undefined) {
            const doHighlight = _s.highlight === true || _s.highlight === undefined;
            jumpToPageWithHighlight(data.source.page, msg, data.source.text, doHighlight);
          }
        }
      } else {
        // Backend returned success: false — show actual error details
        const errMsg = data.error || 'Unknown error from server';
        console.error('❌ Backend returned success: false:', errMsg);

        // User-friendly mapping of common errors
        let userMsg = '';
        if (errMsg.includes('429') || errMsg.toLowerCase().includes('rate limit')) {
          userMsg = '⏳ The AI model is currently rate-limited (too many requests). Please wait a moment and try again, or switch models in settings.';
        } else if (errMsg.includes('timeout') || errMsg.toLowerCase().includes('timed out')) {
          userMsg = '⏱️ The AI took too long to respond. Try a shorter question or try again.';
        } else if (errMsg.includes('503') || errMsg.toLowerCase().includes('unavailable')) {
          userMsg = '🔧 The AI model is temporarily unavailable. Try again in a few seconds.';
        } else if (errMsg.includes('401') || errMsg.toLowerCase().includes('unauthorized') || errMsg.toLowerCase().includes('api key')) {
          userMsg = '🔑 API key issue. Please check your OpenRouter key in server settings.';
        } else if (errMsg.toLowerCase().includes('no choices') || errMsg.toLowerCase().includes('model returned')) {
          userMsg = '🤖 The AI model returned an empty response. This free model may be overloaded — try again.';
        } else {
          userMsg = `❌ Server error: ${errMsg}`;
        }
        const retryBtn = `<br><br><button onclick="window._lastFailedMsg && (document.getElementById('chat-input').value = window._lastFailedMsg) && sendMessage()" style="font-size:11px;font-weight:600;color:#818cf8;background:rgba(129,140,248,0.12);border:1px solid rgba(129,140,248,0.3);border-radius:6px;padding:5px 12px;cursor:pointer;font-family:inherit;">↩ Retry</button>`;
        addChatMessage(userMsg + retryBtn, 'ai');
      }
    } catch (e) {
      console.error('❌ Chat error:', e);
      console.error('❌ Error stack:', e.stack);
      let errMsg = '';
      if (!navigator.onLine) {
        errMsg = '📡 You appear to be offline. Please check your internet connection and try again.';
      } else if (e.name === 'TypeError' && e.message.toLowerCase().includes('fetch')) {
        errMsg = '🔌 Could not reach the server. It may be starting up — please wait a moment and try again.';
      } else if (e.name === 'SyntaxError') {
        errMsg = '⚠️ The server returned an unexpected response. Please try again.';
      } else {
        errMsg = `❌ Unexpected error: ${e.message}`;
      }
      const retryBtn = `<br><br><button onclick="window.retryLastMessage()" style="font-size:11px;font-weight:600;color:#818cf8;background:rgba(129,140,248,0.12);border:1px solid rgba(129,140,248,0.3);border-radius:6px;padding:5px 12px;cursor:pointer;font-family:inherit;">↩ Retry</button>`;
      addChatMessage(errMsg + retryBtn, 'ai');
    } finally {
      typing.classList.remove('active');
      sendBtn.disabled = false;
      input.focus();
      // Save after every AI response so sidebar + refresh stay in sync
      saveCurrentChat();
    }
  }

  window.retryLastMessage = function() {
    if (window._lastFailedMsg) {
      document.getElementById("chat-input").value = window._lastFailedMsg;
      sendMessage();
    }
  };

  // Flashcards button handler — prompts for topic or uses current book
  // Flashcard modal controls
  window._flashcardCardCount = 10;

  window.setCardCount = function(btn, count) {
    window._flashcardCardCount = count;
    document.querySelectorAll('.card-count-btn').forEach(b => {
      b.style.background = 'rgba(255,255,255,0.06)';
      b.style.borderColor = 'rgba(255,255,255,0.1)';
      b.style.color = 'rgba(255,255,255,0.5)';
    });
    btn.style.background = 'rgba(102,126,234,0.2)';
    btn.style.borderColor = 'rgba(102,126,234,0.5)';
    btn.style.color = '#a5b4fc';
  };

  window.closeFlashcardModal = function() {
    const modal = document.getElementById('flashcard-topic-modal');
    if (modal) modal.style.display = 'none';
  };

  window.confirmFlashcardTopic = function() {
    const input = document.getElementById('flashcard-topic-input');
    const topic = input ? input.value.trim() : '';
    if (!topic) {
      input.style.borderColor = 'rgba(248,113,113,0.6)';
      input.focus();
      return;
    }
    closeFlashcardModal();
    generateFlashcardsInChat(topic, window._flashcardCardCount || 10);
  };

  window.openFlashcardModal = function() {
    if (isGuestMode || isFreeTier()) {
      showToast('Flashcards are a Pro & Ultra feature. Upgrade to unlock!');
      openPricingModal();
      return;
    }
    const modal = document.getElementById('flashcard-topic-modal');
    if (!modal) return;
    const bookName = window.currentPdfName || '';
    const input = document.getElementById('flashcard-topic-input');
    if (input) {
      input.value = bookName;
      input.style.borderColor = 'rgba(255,255,255,0.1)';
    }
    // Reset card count to 10
    window._flashcardCardCount = 10;
    document.querySelectorAll('.card-count-btn').forEach(b => {
      const isDefault = b.textContent.trim() === '10';
      b.style.background = isDefault ? 'rgba(102,126,234,0.2)' : 'rgba(255,255,255,0.06)';
      b.style.borderColor = isDefault ? 'rgba(102,126,234,0.5)' : 'rgba(255,255,255,0.1)';
      b.style.color = isDefault ? '#a5b4fc' : 'rgba(255,255,255,0.5)';
    });
    modal.style.display = 'flex';
    setTimeout(() => input && input.focus(), 50);
  };

  // Close modal on backdrop click
  document.getElementById('flashcard-topic-modal')?.addEventListener('click', function(e) {
    if (e.target === this) closeFlashcardModal();
  });

  // Upload PDF from welcome screen — creates a temp input to avoid hidden-element issues
  window.uploadPDFFromWelcome = function() {
    const tmp = document.createElement('input');
    tmp.type = 'file';
    tmp.accept = '.pdf';
    tmp.style.display = 'none';
    document.body.appendChild(tmp);
    tmp.onchange = function(e) {
      document.body.removeChild(tmp);
      if (typeof loadPDF === 'function') loadPDF(e);
    };
    tmp.click();
  };

  window.triggerFlashcards = function() {
    if (isGuestMode || isFreeTier()) {
      showToast('Flashcards are a Pro & Ultra feature. Upgrade to unlock!');
      openPricingModal();
      return;
    }
    openFlashcardModal();
  };

  function extractTopic(message) {
    return message
      .replace(/create|make|generate|give me|show me|flashcards?|flash cards?|quiz|study cards?|for me|for\b|about\b|on\b|a\b|an\b|the\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'general chemistry';
  }

  async function generateFlashcardsInChat(topic, count) {
    count = count || 10;
    if (isGuestMode || isFreeTier()) {
      showToast('🔒 Flashcards are a Pro & Ultra feature. Upgrade to unlock!');
      openPricingModal();
      return;
    }
    const typing = document.getElementById('typing-indicator');
    if (typeof window.setTypingContext === 'function') window.setTypingContext(null, 'flashcard');
    typing.classList.add('active');
    // Update typing label to show topic being generated
    try {
      const tiLabel = document.getElementById('ti-label-text');
      const tiSub = document.getElementById('ti-sub-text');
      if (tiLabel) tiLabel.textContent = `Creating flashcards…`;
      if (tiSub) tiSub.textContent = `Topic: ${topic}`;
    } catch(e) {}
    try {
      const response = await fetch(`${API_URL}/generate-flashcards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, count })
      });
      const data = await response.json();
      if (data.success && data.flashcards) {
        typing.classList.remove('active');
        // Save flashcard set to localStorage
        try {
          const savedSets = JSON.parse(localStorage.getItem('chunks_saved_flashcards') || '[]');
          savedSets.unshift({ topic, cards: data.flashcards, createdAt: new Date().toISOString(), id: Date.now() });
          if (savedSets.length > 20) savedSets.pop();
          localStorage.setItem('chunks_saved_flashcards', JSON.stringify(savedSets));
        } catch(e) {}
        displayFlashcardsInChat(data.flashcards, topic);
      } else {
        typing.classList.remove('active');
        addChatMessage(`❌ Could not generate flashcards: ${data.error || 'Unknown error'}`, 'ai');
      }
    } catch (error) {
      typing.classList.remove('active');
      addChatMessage(`❌ Error: ${error.message}`, 'ai');
    }
  }

  // ==========================================
  // PROGRESS TRACKING SYSTEM
  // ==========================================
  
  function getProgressData() {
    const saved = localStorage.getItem('chunks_progress');
    let progress;
    
    if (saved) {
      progress = JSON.parse(saved);
      // Migration: ensure all fields exist
      if (typeof progress.totalPagesRead === 'undefined') progress.totalPagesRead = 0;
      if (typeof progress.totalQuestions === 'undefined') progress.totalQuestions = 0;
      if (typeof progress.totalStudyTime === 'undefined') progress.totalStudyTime = 0;
      if (!progress.pdfDocuments) progress.pdfDocuments = {};
      if (!progress.recentActivity) progress.recentActivity = [];
      if (typeof progress.studyStreak === 'undefined') progress.studyStreak = 0;
    } else {
      progress = {
        // Flashcard tracking
        topics: {},          // Per-topic flashcard progress
        totalSessions: 0,    // Total flashcard sessions
        totalCards: 0,       // Total cards studied
        totalCorrect: 0,     // Total correct answers
        totalIncorrect: 0,   // Total incorrect answers
        bestStreak: 0,       // Best streak ever
        studyStreak: 0,      // Current consecutive days
        
        // PDF & General tracking
        pdfDocuments: {},    // Per-PDF progress
        totalPagesRead: 0,   // Total pages viewed
        totalStudyTime: 0,   // Total time in minutes
        totalQuestions: 0,   // Total chat questions asked
        sessionStartTime: null, // Current session start
        lastStudied: null,   // Last study date
        
        // Activity logs
        recentActivity: []   // Recent study activities (last 20)
      };
    }
    
    return progress;
  }
  
  function saveProgressData(data) {
    localStorage.setItem('chunks_progress', JSON.stringify(data));
  }
  
  function startStudySession() {
    const progress = getProgressData();
    progress.sessionStartTime = Date.now();
    saveProgressData(progress);
  }
  
  function updateStudyTime() {
    const progress = getProgressData();
    
    if (progress.sessionStartTime) {
      const sessionTime = Math.round((Date.now() - progress.sessionStartTime) / 60000); // minutes
      
      if (sessionTime > 0) {
        progress.totalStudyTime += sessionTime;
      } else {
      }
      
      progress.sessionStartTime = Date.now(); // Reset for next interval
      saveProgressData(progress);
    } else {
    }
  }
  
  function trackPageRead(pageNum, pdfName) {
    try {
      const progress = getProgressData();
      
      // Initialize totalPagesRead if undefined
      if (typeof progress.totalPagesRead === 'undefined') {
        progress.totalPagesRead = 0;
      }
      
      if (!progress.pdfDocuments[pdfName]) {
        progress.pdfDocuments[pdfName] = {
          pagesRead: [],  // Use array instead of Set
          totalPages: 0,
          questionsAsked: 0,
          lastAccessed: null,
          timeSpent: 0
        };
      }
      
      const doc = progress.pdfDocuments[pdfName];
      // Convert to Set for checking, back to array for storage
      const pagesSet = new Set(doc.pagesRead || []);
      const wasNew = !pagesSet.has(pageNum);
      pagesSet.add(pageNum);
      doc.pagesRead = Array.from(pagesSet);
      doc.lastAccessed = new Date().toISOString();
      
      if (wasNew) {
        progress.totalPagesRead++;
        addRecentActivity('page_read', `Read page ${pageNum} in ${pdfName}`, pdfName);
      } else {
      }
      
      saveProgressData(progress);
    } catch (error) {
      console.error('❌ Error in trackPageRead:', error);
    }
  }
  
  function trackQuestion(question, pdfName) {
    try {
      const progress = getProgressData();
      progress.totalQuestions++;
      
      if (pdfName && progress.pdfDocuments[pdfName]) {
        progress.pdfDocuments[pdfName].questionsAsked++;
      }
      
      const shortQ = question.substring(0, 50);
      addRecentActivity('question', shortQ + (question.length > 50 ? '...' : ''), pdfName);
      saveProgressData(progress);
    } catch (error) {
      console.error('Error tracking question:', error);
    }
  }
  
  function addRecentActivity(type, description, context = null) {
    try {
      const progress = getProgressData();
      if (!progress.recentActivity) progress.recentActivity = [];
      
      progress.recentActivity.unshift({
        type: type,
        description: description,
        context: context,
        timestamp: new Date().toISOString()
      });
      
      // Keep only last 20 activities
      progress.recentActivity = progress.recentActivity.slice(0, 20);
      saveProgressData(progress);
    } catch (error) {
      console.error('Error adding recent activity:', error);
    }
  }
  
  function updateProgress(topic, sessionData) {
    const progress = getProgressData();
    
    // Update per-topic data
    if (!progress.topics[topic]) {
      progress.topics[topic] = {
        sessions: [],
        totalCards: 0,
        masteredCards: [],
        averageAccuracy: 0,
        lastStudied: null
      };
    }
    
    const topicData = progress.topics[topic];
    
    // Add session to history
    topicData.sessions.push({
      date: new Date().toISOString(),
      cardsStudied: sessionData.cardsStudied,
      correct: sessionData.correct,
      incorrect: sessionData.incorrect,
      accuracy: sessionData.accuracy,
      streak: sessionData.streak
    });
    
    // Update mastered cards (merge with existing, remove duplicates)
    sessionData.masteredCards.forEach(card => {
      const exists = topicData.masteredCards.some(
        c => c.front === card.front && c.back === card.back
      );
      if (!exists) {
        topicData.masteredCards.push(card);
      }
    });
    
    // Calculate total unique cards for this topic
    topicData.totalCards = Math.max(
      topicData.totalCards,
      sessionData.totalCardsInTopic
    );
    
    // Calculate average accuracy
    const totalAccuracy = topicData.sessions.reduce((sum, s) => sum + s.accuracy, 0);
    topicData.averageAccuracy = Math.round(totalAccuracy / topicData.sessions.length);
    
    topicData.lastStudied = new Date().toISOString();
    
    // Update overall stats
    progress.totalSessions++;
    progress.totalCards += sessionData.cardsStudied;
    progress.totalCorrect += sessionData.correct;
    progress.totalIncorrect += sessionData.incorrect;
    progress.bestStreak = Math.max(progress.bestStreak, sessionData.streak);
    progress.lastStudied = new Date().toISOString();
    
    // Calculate study streak (consecutive days)
    const today = new Date().toDateString();
    const lastStudiedDate = progress.lastStudied ? new Date(progress.lastStudied).toDateString() : null;
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    
    if (lastStudiedDate === yesterday) {
      progress.studyStreak++;
    } else if (lastStudiedDate !== today) {
      progress.studyStreak = 1;
    }
    
    // Add to recent activity
    addRecentActivity('flashcards', `Completed ${topic} flashcards (${sessionData.accuracy}% accuracy)`, topic);
    
    saveProgressData(progress);
    return progress;
  }
  
  function renderSidebarProgress() {
    const progress = getProgressData();
    const container = document.getElementById('progress-content');
    
    if (!container) {
      console.error('Progress content container not found');
      return;
    }
    
    // Load saved flashcard sets and exams
    let savedFlashcards = [];
    let savedExams = [];
    try { savedFlashcards = JSON.parse(localStorage.getItem('chunks_saved_flashcards') || '[]'); } catch(e) {}
    try { savedExams = JSON.parse(localStorage.getItem('chunks_saved_exams') || '[]'); } catch(e) {}
    
    const overallAccuracy = progress.totalCards > 0 
      ? Math.round((progress.totalCorrect / progress.totalCards) * 100) 
      : 0;
    
    let totalMinutes = progress.totalStudyTime || 0;
    if (progress.sessionStartTime) {
      totalMinutes += Math.floor((Date.now() - progress.sessionStartTime) / 60000);
    }
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const timeDisplay = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
    
    const hasAnyData = savedFlashcards.length > 0 || savedExams.length > 0 || 
                       (progress.totalSessions || 0) > 0 || (progress.totalPagesRead || 0) > 0;

    if (!hasAnyData) {
      container.innerHTML = `
        <div style="padding: 48px 20px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 12px;">
          <div style="width: 52px; height: 52px; border-radius: 14px; background: rgba(102,126,234,0.08); border: 1px solid rgba(102,126,234,0.15); display: flex; align-items: center; justify-content: center; opacity: 0.6;">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#667eea" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>
            </svg>
          </div>
          <div>
            <div style="font-size: 13px; color: rgba(255,255,255,0.75); font-weight: 600; margin-bottom: 4px;">No study data yet</div>
            <div style="font-size: 11px; color: rgba(255,255,255,0.35); line-height: 1.6;">Generate flashcards or an exam<br>to get started</div>
          </div>
        </div>
      `;
      return;
    }

    let html = `<div style="padding: 10px 12px 16px;">`;
    
    // ── Stats Row ──
    html += `
      <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; margin-bottom: 14px;">
        <div style="background: rgba(102,126,234,0.08); border: 1px solid rgba(102,126,234,0.2); border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 2px;">
          <div style="font-size: 20px; font-weight: 700; color: #818cf8; line-height: 1;">${progress.totalSessions || 0}</div>
          <div style="font-size: 10px; color: rgba(255,255,255,0.45); text-transform: uppercase; letter-spacing: 0.6px;">Sessions</div>
        </div>
        <div style="background: rgba(74,222,128,0.08); border: 1px solid rgba(74,222,128,0.2); border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 2px;">
          <div style="font-size: 20px; font-weight: 700; color: #4ade80; line-height: 1;">${progress.totalPagesRead || 0}</div>
          <div style="font-size: 10px; color: rgba(255,255,255,0.45); text-transform: uppercase; letter-spacing: 0.6px;">Pages Read</div>
        </div>
        <div style="background: rgba(251,191,36,0.08); border: 1px solid rgba(251,191,36,0.2); border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 2px;">
          <div style="font-size: 20px; font-weight: 700; color: #fbbf24; line-height: 1;">${progress.totalQuestions || 0}</div>
          <div style="font-size: 10px; color: rgba(255,255,255,0.45); text-transform: uppercase; letter-spacing: 0.6px;">Questions</div>
        </div>
        <div style="background: rgba(139,92,246,0.08); border: 1px solid rgba(139,92,246,0.2); border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 2px;">
          <div style="font-size: 20px; font-weight: 700; color: #a78bfa; line-height: 1;">${timeDisplay}</div>
          <div style="font-size: 10px; color: rgba(255,255,255,0.45); text-transform: uppercase; letter-spacing: 0.6px;">Time</div>
        </div>
      </div>
    `;

    // ── Streak ──
    if ((progress.studyStreak || 0) > 0) {
      html += `
        <div style="display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: rgba(251,191,36,0.07); border: 1px solid rgba(251,191,36,0.2); border-radius: 8px; margin-bottom: 14px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>
          <span style="font-size: 12px; color: #fbbf24; font-weight: 600;">${progress.studyStreak}-day study streak!</span>
        </div>
      `;
    }

    // ── Saved Flashcard Sets (with mastery embedded) ──
    if (savedFlashcards.length > 0) {
      html += `
        <div style="margin-bottom: 14px;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#818cf8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
              <span style="font-size: 11px; font-weight: 700; color: rgba(255,255,255,0.55); text-transform: uppercase; letter-spacing: 0.6px;">Flashcard Sets</span>
            </div>
            <span style="font-size: 10px; color: rgba(255,255,255,0.3);">${savedFlashcards.length} saved</span>
          </div>
          <div style="display: flex; flex-direction: column; gap: 5px;">
      `;
      
      savedFlashcards.slice(0, 5).forEach((set, i) => {
        const date = new Date(set.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        const topicData = progress.topics?.[set.topic] || {};
        const mastery = topicData.totalCards > 0 ? Math.round((topicData.masteredCards?.length || 0) / topicData.totalCards * 100) : 0;
        const masteryColor = mastery >= 80 ? '#4ade80' : mastery >= 50 ? '#818cf8' : '#fbbf24';
        const sessionCount = topicData.sessions?.length || 0;
        const masteredCount = topicData.masteredCards?.length || 0;
        const totalCards = topicData.totalCards || set.cards.length;
        
        html += `
          <div class="prog-item-wrap" style="background: rgba(129,140,248,0.05); border: 1px solid rgba(129,140,248,0.12); border-radius: 8px; padding: 9px 11px; transition: all 0.15s;" 
               onmouseenter="this.style.background='rgba(129,140,248,0.1)'; this.style.borderColor='rgba(129,140,248,0.25)'"
               onmouseleave="this.style.background='rgba(129,140,248,0.05)'; this.style.borderColor='rgba(129,140,248,0.12)'"
               id="fc-set-${set.id}">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
              <span style="font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.85); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100px;">${set.topic}</span>
              <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0; margin-left: 6px;">
                ${mastery > 0 ? `<span style="font-size: 11px; font-weight: 700; color: ${masteryColor};">${mastery}%</span>` : ''}
                <button style="font-size: 10px; font-weight: 600; color: #818cf8; background: rgba(129,140,248,0.12); border: 1px solid rgba(129,140,248,0.25); border-radius: 4px; padding: 2px 8px; cursor: pointer; font-family: inherit;" 
                        onclick="event.stopPropagation(); window._replayFlashcardSet(${i})">Study</button>
                <button class="prog-item-dots" onclick="event.stopPropagation(); showProgCtxMenu(event,'fc',${i})">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>
                </button>
              </div>
            </div>
            <div style="background: rgba(255,255,255,0.08); height: 3px; border-radius: 2px; overflow: hidden; margin-bottom: 5px;">
              <div style="background: ${mastery > 0 ? masteryColor : 'rgba(129,140,248,0.3)'}; height: 100%; width: ${mastery > 0 ? mastery : 0}%; transition: width 0.4s;"></div>
            </div>
            <div style="font-size: 10px; color: rgba(255,255,255,0.35);">
              ${set.cards.length} cards${mastery > 0 ? ` · ${masteredCount}/${totalCards} mastered · ${sessionCount} session${sessionCount !== 1 ? 's' : ''}` : ''}
            </div>
          </div>
        `;
      });
      
      html += `</div></div>`;
    }

    // ── Saved Exams (with score) ──
    if (savedExams.length > 0) {
      html += `
        <div style="margin-bottom: 6px;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
              <span style="font-size: 11px; font-weight: 700; color: rgba(255,255,255,0.55); text-transform: uppercase; letter-spacing: 0.6px;">Exams</span>
            </div>
            <span style="font-size: 10px; color: rgba(255,255,255,0.3);">${savedExams.length} saved</span>
          </div>
          <div style="display: flex; flex-direction: column; gap: 5px;">
      `;
      
      savedExams.slice(0, 5).forEach((exam, i) => {
        const date = new Date(exam.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        const hasScore = exam.lastScore !== null && exam.lastScore !== undefined;
        const scoreColor = hasScore ? (exam.lastScore >= 70 ? '#4ade80' : exam.lastScore >= 50 ? '#fbbf24' : '#f87171') : null;
        html += `
          <div class="prog-item-wrap" style="background: rgba(52,211,153,0.05); border: 1px solid rgba(52,211,153,0.12); border-radius: 8px; padding: 9px 11px; transition: all 0.15s;"
               onmouseenter="this.style.background='rgba(52,211,153,0.1)'; this.style.borderColor='rgba(52,211,153,0.25)'"
               onmouseleave="this.style.background='rgba(52,211,153,0.05)'; this.style.borderColor='rgba(52,211,153,0.12)'">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
              <span class="exam-title-label-${exam.id}" style="font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.85); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 90px;">${exam.label || ('Exam ' + (i + 1))}</span>
              <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0; margin-left: 6px;">
                ${hasScore ? `<span style="font-size: 11px; font-weight: 700; color: ${scoreColor};">${exam.lastScore}%</span>` : ''}
                <span style="font-size: 10px; color: rgba(255,255,255,0.3);">${date}</span>
              </div>
            </div>
            ${hasScore ? `
              <div style="background: rgba(255,255,255,0.08); height: 3px; border-radius: 2px; overflow: hidden; margin-bottom: 5px;">
                <div style="background: ${scoreColor}; height: 100%; width: ${exam.lastScore}%; transition: width 0.4s;"></div>
              </div>
            ` : ''}
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <span style="font-size: 10px; color: rgba(255,255,255,0.35);">${exam.questions.length} questions${hasScore ? ' · last attempt' : ''}</span>
              <div style="display: flex; align-items: center; gap: 5px;">
                <button style="font-size: 10px; font-weight: 600; color: #34d399; background: rgba(52,211,153,0.12); border: 1px solid rgba(52,211,153,0.25); border-radius: 4px; padding: 2px 8px; cursor: pointer; font-family: inherit;" 
                        onclick="window._replayExam(${i})">${hasScore ? 'Retake' : 'Start'}</button>
                <button class="prog-item-dots" onclick="event.stopPropagation(); showProgCtxMenu(event,'ex',${i})">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>
                </button>
              </div>
            </div>
          </div>
        `;
      });
      
      html += `</div></div>`;
    }
    
    html += `</div>`;
    container.innerHTML = html;
    
    // Register replay handlers
    window._replayFlashcardSet = function(idx) {
      const sets = JSON.parse(localStorage.getItem('chunks_saved_flashcards') || '[]');
      const set = sets[idx];
      if (!set) return;
      switchChunksTab('chats');
      displayFlashcardsInChat(set.cards, set.topic);
    };
    window._replayExam = function(idx) {
      const exams = JSON.parse(localStorage.getItem('chunks_saved_exams') || '[]');
      const exam = exams[idx];
      if (!exam) return;
      switchChunksTab('chats');
      renderExamQuestions(exam.questions, '', true, exam.id);
    };
  }
  
  // ══════════════════════════════════════════
  // PROGRESS PANEL CONTEXT MENU (global scope)
  // ══════════════════════════════════════════
  window._progCtxEl = null;
  window.closeProgCtx = function() {
    if (window._progCtxEl) { window._progCtxEl.remove(); window._progCtxEl = null; }
  };
  document.addEventListener('click', function() { window.closeProgCtx(); });

  window.showProgCtxMenu = function(e, type, idx) {
    e.stopPropagation();
    window.closeProgCtx();
    const menu = document.createElement('div');
    menu.className = 'chat-ctx-menu';
    menu.onclick = ev => ev.stopPropagation();
    menu.innerHTML = `
      <button class="chat-ctx-item" onclick="window.closeProgCtx();window.renameProgItem('${type}',${idx})">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg> Rename
      </button>
      <div class="chat-ctx-divider"></div>
      <button class="chat-ctx-item danger" onclick="window.closeProgCtx();window.deleteProgItem('${type}',${idx})">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg> Delete
      </button>
    `;
    document.body.appendChild(menu);
    window._progCtxEl = menu;
    const rect = e.currentTarget.getBoundingClientRect();
    let top = rect.bottom + 4, left = rect.left - 130;
    if (left < 8) left = 8;
    if (top + 100 > window.innerHeight) top = rect.top - 100;
    menu.style.cssText = `position:fixed;top:${top}px;left:${left}px;z-index:99999;`;
  };

  window.renameProgItem = function(type, idx) {
    const key = type === 'fc' ? 'chunks_saved_flashcards' : 'chunks_saved_exams';
    const items = JSON.parse(localStorage.getItem(key) || '[]');
    if (!items[idx]) return;
    const current = type === 'fc' ? items[idx].topic : (items[idx].label || ('Exam ' + (idx + 1)));
    const newName = prompt('Rename:', current);
    if (!newName || !newName.trim()) return;
    if (type === 'fc') items[idx].topic = newName.trim();
    else items[idx].label = newName.trim();
    localStorage.setItem(key, JSON.stringify(items));
    if (typeof renderSidebarProgress === 'function') renderSidebarProgress();
  };

  window.deleteProgItem = function(type, idx) {
    const key = type === 'fc' ? 'chunks_saved_flashcards' : 'chunks_saved_exams';
    const items = JSON.parse(localStorage.getItem(key) || '[]');
    if (!items[idx]) return;
    const name = type === 'fc' ? items[idx].topic : (items[idx].label || ('Exam ' + (idx + 1)));
    if (!confirm('Delete "' + name + '"?')) return;
    items.splice(idx, 1);
    localStorage.setItem(key, JSON.stringify(items));
    if (typeof renderSidebarProgress === 'function') renderSidebarProgress();
  };

  function showProgressDashboard() {
    const progress = getProgressData();
    const chat = document.getElementById('chat-messages');
    const typing = document.getElementById('typing-indicator');
    
    if (!chat || !typing) {
      console.error('Chat elements not found');
      _showToast('❌ Error: Could not display progress dashboard');
      return;
    }
    
    const overallAccuracy = progress.totalCards > 0 
      ? Math.round((progress.totalCorrect / progress.totalCards) * 100) 
      : 0;
    
    // Calculate total time including current session
    let totalMinutes = progress.totalStudyTime || 0;
    if (progress.sessionStartTime) {
      const currentSessionMinutes = Math.floor((Date.now() - progress.sessionStartTime) / 60000);
      totalMinutes += currentSessionMinutes;
    }
    
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const timeDisplay = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
    
    // Flashcard topics
    let topicsHTML = '';
    Object.keys(progress.topics || {}).forEach(topic => {
      const topicData = progress.topics[topic];
      const masteryPercentage = topicData.totalCards > 0
        ? Math.round((topicData.masteredCards.length / topicData.totalCards) * 100)
        : 0;
      
      topicsHTML += `
        <div style="padding: 16px; background: rgba(255,255,255,0.05); border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); margin-bottom: 12px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <strong style="font-size: 15px; color: white;">${topic}</strong>
            <span style="font-size: 13px; color: #667eea; font-weight: 600;">${masteryPercentage}% Mastered</span>
          </div>
          <div style="background: rgba(255,255,255,0.1); height: 8px; border-radius: 4px; overflow: hidden; margin-bottom: 12px;">
            <div style="background: linear-gradient(90deg, #667eea, #764ba2); height: 100%; width: ${masteryPercentage}%; transition: width 0.3s;"></div>
          </div>
          <div style="display: flex; gap: 16px; font-size: 13px; color: rgba(255,255,255,0.7);">
            <span>${topicData.masteredCards.length}/${topicData.totalCards} Cards</span>
            <span>•</span>
            <span>${topicData.sessions.length} Sessions</span>
            <span>•</span>
            <span>${topicData.averageAccuracy}% Avg</span>
          </div>
        </div>
      `;
    });
    
    if (Object.keys(progress.topics || {}).length === 0) {
      topicsHTML = '<p style="color: rgba(255,255,255,0.5); text-align: center; padding: 20px;">No flashcard data yet.</p>';
    }
    
    // PDF documents
    let pdfsHTML = '';
    Object.keys(progress.pdfDocuments || {}).forEach(pdfName => {
      const doc = progress.pdfDocuments[pdfName];
      const pagesRead = (doc.pagesRead || []).length;  // Already an array
      const coverage = doc.totalPages > 0 ? Math.round((pagesRead / doc.totalPages) * 100) : 0;
      
      pdfsHTML += `
        <div style="padding: 16px; background: rgba(255,255,255,0.05); border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); margin-bottom: 12px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <strong style="font-size: 15px; color: white;">${pdfName}</strong>
            <span style="font-size: 13px; color: #4ade80; font-weight: 600;">${coverage}% Read</span>
          </div>
          <div style="background: rgba(255,255,255,0.1); height: 8px; border-radius: 4px; overflow: hidden; margin-bottom: 12px;">
            <div style="background: linear-gradient(90deg, #4ade80, #22c55e); height: 100%; width: ${coverage}%; transition: width 0.3s;"></div>
          </div>
          <div style="display: flex; gap: 16px; font-size: 13px; color: rgba(255,255,255,0.7);">
            <span>${pagesRead} Pages Read</span>
            <span>•</span>
            <span>${doc.questionsAsked} Questions</span>
          </div>
        </div>
      `;
    });
    
    if (Object.keys(progress.pdfDocuments || {}).length === 0) {
      pdfsHTML = '<p style="color: rgba(255,255,255,0.5); text-align: center; padding: 20px;">No PDF data yet. Upload a document to start!</p>';
    }
    
    // Recent activity
    let activityHTML = '';
    if (progress.recentActivity && progress.recentActivity.length > 0) {
      progress.recentActivity.slice(0, 10).forEach(activity => {
        const date = new Date(activity.timestamp);
        const timeAgo = getTimeAgo(date);
        
        let icon = '';
        let color = '';
        if (activity.type === 'flashcards') {
          icon = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#667eea" stroke-width="2"><path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/></svg>';
          color = '#667eea';
        } else if (activity.type === 'page_read') {
          icon = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>';
          color = '#4ade80';
        } else if (activity.type === 'question') {
          icon = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>';
          color = '#fbbf24';
        }
        
        activityHTML += `
          <div style="display: flex; gap: 12px; padding: 10px; background: rgba(255,255,255,0.03); border-radius: 6px; margin-bottom: 8px;">
            <div style="flex-shrink: 0; margin-top: 2px;">${icon}</div>
            <div style="flex: 1; min-width: 0;">
              <div style="font-size: 13px; color: white; margin-bottom: 2px;">${activity.description}</div>
              <div style="font-size: 11px; color: rgba(255,255,255,0.5);">${timeAgo}</div>
            </div>
          </div>
        `;
      });
    } else {
      activityHTML = '<p style="color: rgba(255,255,255,0.5); text-align: center; padding: 20px;">No recent activity.</p>';
    }
    
    const container = document.createElement('div');
    container.className = 'message ai';
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    
    bubble.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 16px;">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#667eea" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 3v18h18"/>
          <path d="m19 9-5 5-4-4-3 3"/>
        </svg>
        <strong style="font-size: 18px;">Your Progress</strong>
      </div>
      
      <!-- Overall Stats -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; margin-bottom: 20px;">
        <div style="padding: 16px; background: rgba(102,126,234,0.1); border-radius: 8px; border: 1px solid rgba(102,126,234,0.3); text-align: center;">
          <div style="font-size: 24px; font-weight: 700; color: #667eea; margin-bottom: 4px;">${progress.totalSessions}</div>
          <div style="font-size: 11px; color: rgba(255,255,255,0.6); text-transform: uppercase;">Flashcard<br>Sessions</div>
        </div>
        <div style="padding: 16px; background: rgba(74,222,128,0.1); border-radius: 8px; border: 1px solid rgba(74,222,128,0.3); text-align: center;">
          <div style="font-size: 24px; font-weight: 700; color: #4ade80; margin-bottom: 4px;">${progress.totalPagesRead}</div>
          <div style="font-size: 11px; color: rgba(255,255,255,0.6); text-transform: uppercase;">Pages<br>Read</div>
        </div>
        <div style="padding: 16px; background: rgba(251,191,36,0.1); border-radius: 8px; border: 1px solid rgba(251,191,36,0.3); text-align: center;">
          <div style="font-size: 24px; font-weight: 700; color: #fbbf24; margin-bottom: 4px;">${progress.totalQuestions}</div>
          <div style="font-size: 11px; color: rgba(255,255,255,0.6); text-transform: uppercase;">Questions<br>Asked</div>
        </div>
        <div style="padding: 16px; background: rgba(139,92,246,0.1); border-radius: 8px; border: 1px solid rgba(139,92,246,0.3); text-align: center;">
          <div style="font-size: 24px; font-weight: 700; color: #8b5cf6; margin-bottom: 4px;">${timeDisplay}</div>
          <div style="font-size: 11px; color: rgba(255,255,255,0.6); text-transform: uppercase;">Study<br>Time</div>
        </div>
      </div>
      
      ${progress.studyStreak > 0 ? `
        <div style="padding: 12px; background: rgba(251,191,36,0.1); border-radius: 8px; border: 1px solid rgba(251,191,36,0.3); margin-bottom: 20px; text-align: center;">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: inline-block; vertical-align: middle; margin-right: 6px;">
            <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>
          </svg>
          <span style="color: #fbbf24; font-weight: 600; font-size: 14px;">
            ${progress.studyStreak} day${progress.studyStreak > 1 ? 's' : ''} study streak! 🔥
          </span>
        </div>
      ` : ''}
      
      <!-- Recent Activity -->
      <div style="margin-top: 20px; margin-bottom: 20px;">
        <h3 style="font-size: 16px; color: rgba(255,255,255,0.8); margin-bottom: 12px; font-weight: 600;">Recent Activity</h3>
        <div style="max-height: 300px; overflow-y: auto;">
          ${activityHTML}
        </div>
      </div>
      
      <!-- PDF Documents -->
      <div style="margin-top: 20px;">
        <h3 style="font-size: 16px; color: rgba(255,255,255,0.8); margin-bottom: 12px; font-weight: 600;">Documents</h3>
        ${pdfsHTML}
      </div>
      
      <!-- Flashcard Topics -->
      <div style="margin-top: 20px;">
        <h3 style="font-size: 16px; color: rgba(255,255,255,0.8); margin-bottom: 12px; font-weight: 600;">Flashcard Topics</h3>
        ${topicsHTML}
      </div>
      
      <p style="color: rgba(255,255,255,0.5); font-size: 12px; margin-top: 16px; text-align: center;">
        Keep studying to improve your stats! 📚
      </p>

      <div style="margin-top: 16px; text-align: center;">
        <a href="study_dashboard.html"
          style="display:inline-flex;align-items:center;gap:8px;padding:11px 24px;
          background:linear-gradient(135deg,#667eea,#764ba2);border-radius:10px;
          color:white;font-size:14px;font-weight:700;text-decoration:none;
          box-shadow:0 4px 16px rgba(102,126,234,0.35);">
          📊 Open Full Dashboard
        </a>
      </div>
    `;
    
    container.appendChild(bubble);
    chat.insertBefore(container, typing);
    chat.scrollTop = chat.scrollHeight;
  }
  
  function getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
    if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
    if (seconds < 604800) return Math.floor(seconds / 86400) + 'd ago';
    return date.toLocaleDateString();
  }

  function displayFlashcardsInChat(flashcards, topic) {
    const chat = document.getElementById('chat-messages');
    const typing = document.getElementById('typing-indicator');
    const container = document.createElement('div');
    container.className = 'message ai';
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble flashcard-bubble';
    const timestamp = Date.now();
    
    // Initialize study session
    let currentCard = 0;
    let correct = 0;
    let incorrect = 0;
    let streak = 0;
    let maxStreak = 0;
    let isFlipped = false;
    let knownCards = []; // Track cards marked as "I Know This"
    let activeFlashcards = [...flashcards]; // Working copy of flashcards
    
    function updateDisplay() {
      if (currentCard >= activeFlashcards.length) {
        showComplete();
        return;
      }
      
      const card = activeFlashcards[currentCard];
      const progress = ((currentCard) / activeFlashcards.length) * 100;
      isFlipped = false; // Reset flip state for new card
      
      bubble.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#667eea" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
          </svg>
          <strong style="font-size: 16px;">Studying: ${topic}</strong>
        </div>
        
        <!-- Progress & Stats -->
        <div class="flashcard-controls">
          <div class="flashcard-progress">
            <div class="progress-text">
              <span>Card ${currentCard + 1} of ${activeFlashcards.length}</span>
              <span>${Math.round(progress)}%</span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${progress}%"></div>
            </div>
          </div>
          <div class="flashcard-stats">
            <div class="stat stat-correct">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M20 6 9 17l-5-5"/>
              </svg>
              ${correct}
            </div>
            <div class="stat stat-incorrect">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 6 6 18"/>
                <path d="m6 6 12 12"/>
              </svg>
              ${incorrect}
            </div>
            <div class="stat stat-streak">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>
              </svg>
              ${streak}
            </div>
          </div>
        </div>
        
        <!-- Flashcard -->
        <div class="mini-flashcards">
          <div class="mini-card" id="flashcard-${timestamp}">
            <div class="mini-card-inner" id="flashcard-inner-${timestamp}">
              <div class="mini-card-front">
                <div class="card-label">Question</div>
                <div class="card-content">${card.front}</div>
                <div class="card-hint">tap to reveal →</div>
              </div>
              <div class="mini-card-back">
                <div class="card-label">Answer</div>
                <div class="card-content">${card.back}</div>
              </div>
            </div>
          </div>
        </div>
        
        <!-- Actions -->
        <div class="flashcard-actions" id="flashcard-actions-${timestamp}">
          <button class="flashcard-btn btn-flip" id="flip-btn-${timestamp}">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
            </svg>
            Flip Card
          </button>
          <button class="flashcard-btn btn-know" id="know-btn-${timestamp}" style="display: none;">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
              <path d="m9 11 3 3L22 4"/>
            </svg>
            I Know This
          </button>
          <button class="flashcard-btn btn-dont-know" id="dontknow-btn-${timestamp}" style="display: none;">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <path d="m15 9-6 6"/>
              <path d="m9 9 6 6"/>
            </svg>
            Need Review
          </button>
        </div>
      `;
      
      // Attach event listeners after DOM is updated
      setTimeout(() => {
        const flipBtn = document.getElementById(`flip-btn-${timestamp}`);
        const knowBtn = document.getElementById(`know-btn-${timestamp}`);
        const dontKnowBtn = document.getElementById(`dontknow-btn-${timestamp}`);
        const cardEl = document.getElementById(`flashcard-${timestamp}`);

        function doFlip() {
          if (!cardEl) return;
          isFlipped = !isFlipped;
          if (isFlipped) {
            cardEl.classList.add('flipped');
            if (knowBtn) knowBtn.style.display = 'flex';
            if (dontKnowBtn) dontKnowBtn.style.display = 'flex';
            if (flipBtn) { flipBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg> Flip Back`; }
          } else {
            cardEl.classList.remove('flipped');
            if (knowBtn) knowBtn.style.display = 'none';
            if (dontKnowBtn) dontKnowBtn.style.display = 'none';
            if (flipBtn) { flipBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg> Reveal Answer`; }
          }
        }

        // Click card itself to flip
        if (cardEl) cardEl.addEventListener('click', doFlip);
        
        if (flipBtn) {
          flipBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg> Reveal Answer`;
          flipBtn.addEventListener('click', doFlip);
        }
        
        if (knowBtn) {
          knowBtn.addEventListener('click', () => {
            const card = activeFlashcards[currentCard];
            knownCards.push(card);
            correct++;
            streak++;
            if (streak > maxStreak) maxStreak = streak;
            // #19: Spaced repetition — track this card as known with timestamp
            try {
              const srKey = 'chunks_sr_' + (topic || 'general').replace(/[^a-z0-9]/gi,'_').toLowerCase();
              const srData = JSON.parse(localStorage.getItem(srKey) || '{}');
              const cardKey = (card.front || '').substring(0, 50);
              const now = Date.now();
              const prev = srData[cardKey];
              // Increase interval exponentially: 1 day → 3 → 7 → 14 → 30
              const intervals = [1,3,7,14,30];
              const idx = prev ? Math.min((prev.level || 0) + 1, intervals.length - 1) : 0;
              srData[cardKey] = { level: idx, nextReview: now + intervals[idx] * 86400000, lastSeen: now };
              localStorage.setItem(srKey, JSON.stringify(srData));
            } catch(e) {}
            currentCard++;
            updateDisplay();
            saveChatHistory();
          });
        }
        
        if (dontKnowBtn) {
          dontKnowBtn.addEventListener('click', () => {
            const card = activeFlashcards[currentCard];
            incorrect++;
            streak = 0;
            // #19: Reset spaced repetition level for wrong answers
            try {
              const srKey = 'chunks_sr_' + (topic || 'general').replace(/[^a-z0-9]/gi,'_').toLowerCase();
              const srData = JSON.parse(localStorage.getItem(srKey) || '{}');
              const cardKey = (card.front || '').substring(0, 50);
              const prev = srData[cardKey];
              // SM-2: reset repetitions, penalise easiness factor on failure
              const ef = prev ? Math.max(1.3, (prev.ef || 2.5) - 0.2) : 2.5;
              srData[cardKey] = { level: 0, ef, interval: 1, nextReview: Date.now() + 86400000, lastSeen: Date.now() };
              localStorage.setItem(srKey, JSON.stringify(srData));
            } catch(e) {}
            currentCard++;
            updateDisplay();
            saveChatHistory();
          });
        }
        
        renderMath(bubble);
      }, 0);
    }
    
    function showComplete() {
      const accuracy = activeFlashcards.length > 0 ? Math.round((correct / activeFlashcards.length) * 100) : 0;
      
      // Save progress data
      const incorrectCards_for_rec = activeFlashcards.filter(c => !knownCards.some(k => k.front === c.front));
      updateProgress(topic, {
        cardsStudied: activeFlashcards.length,
        correct: correct,
        incorrect: incorrect,
        accuracy: accuracy,
        streak: maxStreak,
        masteredCards: knownCards,
        totalCardsInTopic: flashcards.length
      });
      
      // Choose icon and message based on accuracy
      let icon, message;
      if (accuracy >= 80) {
        icon = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/></svg>';
        message = 'Excellent work! You\'ve mastered this topic!';
      } else if (accuracy >= 60) {
        icon = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#667eea" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/></svg>';
        message = 'Good progress! Review the cards you missed.';
      } else {
        icon = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 12h12"/><path d="M6 12c0 1-1 2-2 2s-2-1-2-2 1-2 2-2 2 1 2 2Z"/><path d="M18 12c0 1 1 2 2 2s2-1 2-2-1-2-2-2-2 1-2 2Z"/><path d="M6 12v5a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-5"/><path d="M10 9V7a2 2 0 1 1 4 0v2"/></svg>';
        message = 'Keep practicing! You\'re on your way to mastery.';
      }
      
      bubble.innerHTML = `
        <div class="flashcard-complete">
          <div class="complete-title">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#667eea" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: inline-block; vertical-align: middle; margin-right: 8px;">
              <path d="m11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/>
            </svg>
            Study Session Complete!
          </div>
          <div class="complete-stats">
            <div class="complete-stat">
              <div class="complete-stat-value" style="color: #667eea;">${flashcards.length}</div>
              <div class="complete-stat-label">Cards Studied</div>
            </div>
            <div class="complete-stat">
              <div class="complete-stat-value" style="color: #4ade80;">${correct}</div>
              <div class="complete-stat-label">Correct</div>
            </div>
            <div class="complete-stat">
              <div class="complete-stat-value" style="color: #f87171;">${incorrect}</div>
              <div class="complete-stat-label">Need Review</div>
            </div>
            <div class="complete-stat">
              <div class="complete-stat-value" style="color: #fbbf24;">${maxStreak}</div>
              <div class="complete-stat-label">Best Streak</div>
            </div>
            <div class="complete-stat">
              <div class="complete-stat-value" style="color: #667eea;">${accuracy}%</div>
              <div class="complete-stat-label">Accuracy</div>
            </div>
          </div>
          <p style="color: rgba(255,255,255,0.6); margin-top: 16px; display: flex; align-items: center; justify-content: center; gap: 8px;">
            ${icon} ${message}
          </p>
          ${knownCards.length > 0 ? `
          <div style="margin-top: 20px; padding: 16px; background: rgba(255,255,255,0.03); border-radius: 8px; border: 1px solid rgba(255,255,255,0.06);">
            <div style="font-size: 13px; color: rgba(255,255,255,0.7); margin-bottom: 8px; text-align: center;">
              📊 Card Status
            </div>
            <div style="display: flex; gap: 12px; justify-content: center; align-items: center;">
              <div style="display: flex; align-items: center; gap: 6px;">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                  <path d="m9 11 3 3L22 4"/>
                </svg>
                <span style="color: #4ade80; font-weight: 600;">${knownCards.length} Mastered</span>
              </div>
              <div style="color: rgba(255,255,255,0.3);">|</div>
              <div style="display: flex; align-items: center; gap: 6px;">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M12 8v4"/>
                  <path d="M12 16h.01"/>
                </svg>
                <span style="color: #f87171; font-weight: 600;">${flashcards.length - knownCards.length} To Review</span>
              </div>
            </div>
          </div>
          ` : ''}
          
          <!-- Retry Actions -->
          <div class="flashcard-actions" style="margin-top: 24px; flex-wrap: wrap;">
            ${knownCards.length > 0 && knownCards.length < flashcards.length ? `
              <button class="flashcard-btn btn-know" id="retry-wrong-btn-${timestamp}">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
                  <path d="M21 3v5h-5"/>
                </svg>
                Retry Wrong Cards (${flashcards.length - knownCards.length})
              </button>
              <button class="flashcard-btn" id="shuffle-wrong-btn-${timestamp}" style="background: rgba(102,126,234,0.15); color: #667eea; border: 1px solid rgba(102,126,234,0.3);">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="m18 14 4 4-4 4"/>
                  <path d="m18 2 4 4-4 4"/>
                  <path d="M2 18h1.973a4 4 0 0 0 2.483-.874l8.272-6.252a4 4 0 0 1 2.483-.874H22"/>
                  <path d="M2 6h1.973a4 4 0 0 1 2.483.874l8.272 6.252a4 4 0 0 0 2.483.874H22"/>
                </svg>
                Shuffle Wrong Cards
              </button>
            ` : `
              <button class="flashcard-btn btn-know" id="retry-btn-${timestamp}">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
                  <path d="M21 3v5h-5"/>
                </svg>
                Try Again
              </button>
              <button class="flashcard-btn" id="shuffle-btn-${timestamp}" style="background: rgba(102,126,234,0.15); color: #667eea; border: 1px solid rgba(102,126,234,0.3);">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="m18 14 4 4-4 4"/>
                  <path d="m18 2 4 4-4 4"/>
                  <path d="M2 18h1.973a4 4 0 0 0 2.483-.874l8.272-6.252a4 4 0 0 1 2.483-.874H22"/>
                  <path d="M2 6h1.973a4 4 0 0 1 2.483.874l8.272 6.252a4 4 0 0 0 2.483.874H22"/>
                </svg>
                Shuffle & Retry
              </button>
            `}
            ${knownCards.length > 0 && knownCards.length < flashcards.length ? `
              <button class="flashcard-btn btn-flip" id="retry-all-btn-${timestamp}">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/>
                  <path d="m6.08 9.5-3.5 1.6a1 1 0 0 0 0 1.81l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9a1 1 0 0 0 0-1.83l-3.5-1.59"/>
                  <path d="m6.08 14.5-3.5 1.6a1 1 0 0 0 0 1.81l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9a1 1 0 0 0 0-1.83l-3.5-1.59"/>
                </svg>
                Retry All Cards (${flashcards.length})
              </button>
            ` : ''}
          </div>
          
          <!-- View Progress Button -->
          <div style="margin-top: 16px; text-align: center;">
            <button class="flashcard-btn" id="view-progress-btn-${timestamp}" style="background: rgba(139,92,246,0.15); color: #8b5cf6; border: 1px solid rgba(139,92,246,0.3);">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 3v18h18"/>
                <path d="m19 9-5 5-4-4-3 3"/>
              </svg>
              View My Progress
            </button>
          </div>
        </div>
      `;
      
      // Attach retry button listeners
      setTimeout(() => {
        const retryWrongBtn = document.getElementById(`retry-wrong-btn-${timestamp}`);
        const shuffleWrongBtn = document.getElementById(`shuffle-wrong-btn-${timestamp}`);
        const retryAllBtn = document.getElementById(`retry-all-btn-${timestamp}`);
        const retryBtn = document.getElementById(`retry-btn-${timestamp}`);
        const shuffleBtn = document.getElementById(`shuffle-btn-${timestamp}`);
        
        // Retry wrong cards only (keep same order)
        // AI Learning Loop: show recommendation for low/mid accuracy
        if (accuracy < 90 && incorrectCards_for_rec && incorrectCards_for_rec.length > 0) {
          const completionDiv = bubble.querySelector('.flashcard-complete');
          if (completionDiv) {
            showAIRecommendation(topic, accuracy, incorrectCards_for_rec, completionDiv);
          }
        }

        if (retryWrongBtn) {
          retryWrongBtn.addEventListener('click', () => {
            // Filter out known cards
            activeFlashcards = flashcards.filter(card => !knownCards.includes(card));
            currentCard = 0;
            correct = 0;
            incorrect = 0;
            streak = 0;
            maxStreak = 0;
            updateDisplay();
            saveChatHistory();
          });
        }
        
        // Shuffle wrong cards only
        if (shuffleWrongBtn) {
          shuffleWrongBtn.addEventListener('click', () => {
            // Filter out known cards
            activeFlashcards = flashcards.filter(card => !knownCards.includes(card));
            // Shuffle
            for (let i = activeFlashcards.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [activeFlashcards[i], activeFlashcards[j]] = [activeFlashcards[j], activeFlashcards[i]];
            }
            currentCard = 0;
            correct = 0;
            incorrect = 0;
            streak = 0;
            maxStreak = 0;
            updateDisplay();
            saveChatHistory();
          });
        }
        
        // Retry all cards (reset everything)
        if (retryAllBtn) {
          retryAllBtn.addEventListener('click', () => {
            activeFlashcards = [...flashcards];
            knownCards = [];
            currentCard = 0;
            correct = 0;
            incorrect = 0;
            streak = 0;
            maxStreak = 0;
            updateDisplay();
            saveChatHistory();
          });
        }
        
        // Regular retry (all cards, no filtering - for when no cards are marked as known yet)
        if (retryBtn) {
          retryBtn.addEventListener('click', () => {
            activeFlashcards = [...flashcards];
            currentCard = 0;
            correct = 0;
            incorrect = 0;
            streak = 0;
            maxStreak = 0;
            updateDisplay();
            saveChatHistory();
          });
        }
        
        // Regular shuffle (all cards)
        if (shuffleBtn) {
          shuffleBtn.addEventListener('click', () => {
            activeFlashcards = [...flashcards];
            for (let i = activeFlashcards.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [activeFlashcards[i], activeFlashcards[j]] = [activeFlashcards[j], activeFlashcards[i]];
            }
            currentCard = 0;
            correct = 0;
            incorrect = 0;
            streak = 0;
            maxStreak = 0;
            updateDisplay();
            saveChatHistory();
          });
        }
        
        // View Progress button
        const viewProgressBtn = document.getElementById(`view-progress-btn-${timestamp}`);
        if (viewProgressBtn) {
          viewProgressBtn.addEventListener('click', () => {
            showProgressDashboard();
          });
        } else {
          console.error('❌ View Progress button not found');
        }

        // #22: Export flashcards as text
        const exportBtn = document.createElement('button');
        exportBtn.textContent = '⬇ Export Cards';
        exportBtn.style.cssText = 'background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.6);border-radius:8px;padding:7px 14px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;margin-top:8px;';
        exportBtn.title = 'Copy all flashcards as plain text';
        exportBtn.onclick = function() {
          const lines = flashcards.map((c, i) => `${i+1}. Q: ${c.front}\n   A: ${c.back}`).join('\n\n');
          const blob = new Blob([`Flashcards: ${topic}\n${'='.repeat(40)}\n\n${lines}`], { type: 'text/plain' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `flashcards-${(topic||'study').replace(/[^a-z0-9]/gi,'-').toLowerCase()}.txt`;
          a.click();
          URL.revokeObjectURL(url);
          exportBtn.textContent = '✅ Exported!';
          setTimeout(() => { exportBtn.textContent = '⬇ Export Cards'; }, 2000);
        };
        bubble.querySelector('[id^="flashcard-complete-"]')?.appendChild(exportBtn);
      }, 0);
    }
    
    container.appendChild(bubble);
    chat.insertBefore(container, typing);
    chat.scrollTop = chat.scrollHeight;
    updateDisplay();
    saveChatHistory();
  }

  function flipMiniCard(id) {
    const card = document.getElementById(`mini-card-${id}`);
    if (card) card.classList.toggle('flipped');
  }

  function addChatMessage(text, sender, source = null, msgId = null, allSources = null, webCitations = []) {
    const chat = document.getElementById('chat-messages');
    const typing = document.getElementById('typing-indicator');
    const div = document.createElement('div');
    div.className = `message ${sender}`;
    if (msgId) div.id = msgId;
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';

    if (sender === 'user') {
      // ── User message ──────────────────────────────────────────────
      bubble.textContent = text;
      div.appendChild(bubble);

      // Edit controls
      const ICON_EDIT = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>`;
      const uActions = document.createElement('div');
      uActions.className = 'user-msg-actions';
      const editBtn = document.createElement('button');
      editBtn.className = 'user-action-btn';
      editBtn.title = 'Edit message';
      editBtn.innerHTML = ICON_EDIT;
      editBtn.addEventListener('click', () => {
        if (div.querySelector('.user-edit-wrapper')) return;
        const original = bubble.textContent;
        const wrapper = document.createElement('div');
        wrapper.className = 'user-edit-wrapper';
        const ta = document.createElement('textarea');
        ta.className = 'user-edit-area';
        ta.value = original;
        ta.rows = Math.max(2, Math.ceil(original.length / 50));
        const btnRow = document.createElement('div');
        btnRow.className = 'user-edit-btns';
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'user-edit-cancel';
        cancelBtn.textContent = 'Cancel';
        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'user-edit-confirm';
        confirmBtn.textContent = 'Save & Send';
        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(confirmBtn);
        wrapper.appendChild(ta);
        wrapper.appendChild(btnRow);
        bubble.style.display = 'none';
        uActions.style.display = 'none';
        div.appendChild(wrapper);
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
        const closeEdit = () => { wrapper.remove(); bubble.style.display = ''; uActions.style.display = ''; };
        cancelBtn.addEventListener('click', closeEdit);
        confirmBtn.addEventListener('click', () => {
          const newText = ta.value.trim();
          if (!newText) return;
          bubble.textContent = newText;
          closeEdit();
          let next = div.nextElementSibling;
          while (next && next.classList.contains('message') && next.classList.contains('ai')) {
            const toRemove = next; next = next.nextElementSibling; toRemove.remove();
          }
          window._regenTargetMsg = 'edit';
          document.getElementById('chat-input').value = newText;
          sendMessage();
        });
        ta.addEventListener('keydown', e => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); confirmBtn.click(); }
          if (e.key === 'Escape') closeEdit();
        });
      });
      uActions.appendChild(editBtn);
      div.appendChild(uActions);

    } else {
      // ── AI message ────────────────────────────────────────────────

      // ── AI header (avatar + label, GPT-style) ─────────────────────
      const aiHeader = document.createElement('div');
      aiHeader.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:10px;';
      const aiAvatar = document.createElement('div');
      aiAvatar.className = 'chunks-bot-avatar';
      aiAvatar.innerHTML = `
        <div class="chunks-bot-avatar-icon">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="28" height="28">
            <defs>
              <radialGradient id="avBg" cx="50%" cy="50%" r="70%">
                <stop offset="0%"   stop-color="#1a1230"/>
                <stop offset="100%" stop-color="#0a0a0f"/>
              </radialGradient>
              <linearGradient id="avOrb1" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%"   stop-color="#667eea"/>
                <stop offset="100%" stop-color="#a855f7"/>
              </linearGradient>
              <linearGradient id="avOrb2" x1="100%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%"   stop-color="#764ba2"/>
                <stop offset="100%" stop-color="#667eea"/>
              </linearGradient>
              <filter id="avGlow">
                <feGaussianBlur stdDeviation="2.5" result="blur"/>
                <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
              <filter id="avNucGlow">
                <feGaussianBlur stdDeviation="3" result="blur"/>
                <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
            </defs>
            <rect width="100" height="100" rx="22" fill="url(#avBg)"/>
            <ellipse class="orb-ring-1" cx="50" cy="50" rx="40" ry="14"
                     fill="none" stroke="url(#avOrb1)" stroke-width="5.5"
                     filter="url(#avGlow)" opacity="0.92"/>
            <ellipse class="orb-ring-2" cx="50" cy="50" rx="40" ry="14"
                     fill="none" stroke="url(#avOrb2)" stroke-width="5.5"
                     filter="url(#avGlow)" opacity="0.88"/>
            <ellipse class="orb-ring-3" cx="50" cy="50" rx="40" ry="14"
                     fill="none" stroke="url(#avOrb1)" stroke-width="5.5"
                     filter="url(#avGlow)" opacity="0.85"/>
            <circle cx="50" cy="50" r="10" fill="#a855f7" opacity="0.25" filter="url(#avNucGlow)"/>
            <circle class="orb-nucleus" cx="50" cy="50" r="7" fill="#dcc8ff"/>
          </svg>
        </div>
        <div class="chunks-bot-tooltip">
          <div class="chunks-bot-tooltip-line1"><span class="wave">👋</span> Hi, I'm Chunks AI!</div>
          <div class="chunks-bot-tooltip-line2">Ask me anything ✨</div>
        </div>
      `;
      const aiLabel = document.createElement('span');
      aiLabel.style.cssText = 'font-size:12px;font-weight:700;color:rgba(255,255,255,0.55);letter-spacing:0.02em;font-family:"Inter","DM Sans",sans-serif;';
      aiLabel.textContent = 'Chunks AI';
      aiHeader.appendChild(aiAvatar);
      aiHeader.appendChild(aiLabel);
      bubble.prepend(aiHeader);

      // ── Render content with typewriter stream ─────────────────────
      const contentDiv = document.createElement('div');
      contentDiv.className = 'ai-content';
      bubble.appendChild(contentDiv);

      // Check if this is a "system" message (short, no need to stream)
      const isSimpleMsg = text.length < 120 || text.startsWith('<') || text.startsWith('✅') || text.startsWith('❌') || text.startsWith('⚠️') || text.startsWith('🔒') || text.startsWith('📥') || text.startsWith('⚡');

      if (isSimpleMsg) {
        contentDiv.innerHTML = formatAIResponse(text);
      } else {
        // Typewriter: stream HTML word-by-word after formatting
        const formatted = formatAIResponse(text);
        // Fast stream: reveal full HTML in chunks for smooth feel
        let charIdx = 0;
        const CHUNK = 18; // chars per tick
        const TICK  = 10; // ms per tick
        const streamInterval = setInterval(() => {
          charIdx = Math.min(charIdx + CHUNK, formatted.length);
          // Avoid broken HTML mid-tag by snapping to nearest '>'
          let safeIdx = charIdx;
          if (charIdx < formatted.length) {
            const nextGT = formatted.indexOf('>', charIdx);
            const nextLT = formatted.indexOf('<', charIdx);
            if (nextLT !== -1 && (nextGT === -1 || nextLT < nextGT)) {
              safeIdx = nextLT;
            }
          }
          contentDiv.innerHTML = formatted.slice(0, safeIdx) + (safeIdx < formatted.length ? '<span class="ai-cursor">▍</span>' : '');
          // Auto-scroll while streaming
          const chatEl = document.getElementById('chat-messages');
          if (chatEl) chatEl.scrollTop = chatEl.scrollHeight;
          if (charIdx >= formatted.length) {
            clearInterval(streamInterval);
            contentDiv.innerHTML = formatted;
            // Trigger MathJax typeset after stream finishes
            if (window.MathJax && MathJax.typesetPromise) {
              MathJax.typesetPromise([contentDiv]).catch(() => {});
            }
          }
        }, TICK);
      }
      const pagesToShow = (allSources && allSources.length > 0) ? allSources :
                          (source && source.page ? [source] : []);
      if (pagesToShow.length > 0 && typeof pdfDoc !== 'undefined' && pdfDoc) {
        const refBar = document.createElement('div');
        refBar.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-top:12px;padding:10px 12px;background:rgba(102,126,234,0.06);border:1px solid rgba(102,126,234,0.15);border-radius:10px;align-items:center;';
        const lbl = document.createElement('span');
        lbl.style.cssText = 'font-size:11px;color:rgba(255,255,255,0.4);font-weight:600;margin-right:4px;flex-shrink:0;';
        lbl.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:middle;margin-right:4px;opacity:0.6"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>From your book:';
        refBar.appendChild(lbl);
        pagesToShow.forEach(src => {
          const pn = parseInt(src.page);
          const badge = document.createElement('button');
          badge.style.cssText = 'cursor:pointer;background:rgba(129,140,248,0.15);border:1px solid rgba(129,140,248,0.35);border-radius:20px;padding:4px 12px;font-size:12px;font-weight:700;color:#a5b4fc;white-space:nowrap;transition:all 0.15s;font-family:inherit;display:flex;align-items:center;gap:4px;';
          badge.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg> See page ${pn} →`;
          badge.title = `Jump to page ${pn} in the textbook`;
          badge.onmouseenter = () => { badge.style.background = 'rgba(129,140,248,0.3)'; badge.style.borderColor = 'rgba(129,140,248,0.6)'; };
          badge.onmouseleave = () => { badge.style.background = 'rgba(129,140,248,0.15)'; badge.style.borderColor = 'rgba(129,140,248,0.35)'; };
          badge.onclick = () => jumpToPage(pn);
          refBar.appendChild(badge);
        });
        bubble.appendChild(refBar);
      }
      if (source && (source.textbook || source.chapter) && source.chapter !== 'N/A') {
        const footer = document.createElement('div');
        footer.className = 'source-footer';
        footer.innerHTML = `<svg class="icon" width="18" height="18"><use href="#icon-books"/></svg> ${source.textbook || 'Textbook'} • ${source.chapter || 'Chapter N/A'}`;
        bubble.appendChild(footer);
      }

      // ── Web Citations ─────────────────────────────────────────────
      if (webCitations && webCitations.length > 0) {
        const citBar = document.createElement('div');
        citBar.style.cssText = 'margin-top:14px;padding-top:12px;border-top:1px solid rgba(99,102,241,0.2);';
        const citLabel = document.createElement('div');
        citLabel.style.cssText = 'font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:rgba(165,180,252,0.7);margin-bottom:8px;display:flex;align-items:center;gap:5px;';
        citLabel.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg> Sources`;
        citBar.appendChild(citLabel);
        const citGrid = document.createElement('div');
        citGrid.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
        webCitations.slice(0, 6).forEach((cit, idx) => {
          const card = document.createElement('a');
          card.href = cit.url;
          card.target = '_blank';
          card.rel = 'noopener noreferrer';
          card.style.cssText = `
            display:flex;align-items:center;gap:10px;
            padding:8px 12px;
            background:rgba(99,102,241,0.08);
            border:1px solid rgba(99,102,241,0.2);
            border-radius:9px;
            text-decoration:none;
            color:inherit;
            transition:all 0.18s;
            cursor:pointer;
          `;
          card.onmouseenter = () => {
            card.style.background = 'rgba(99,102,241,0.18)';
            card.style.borderColor = 'rgba(99,102,241,0.45)';
          };
          card.onmouseleave = () => {
            card.style.background = 'rgba(99,102,241,0.08)';
            card.style.borderColor = 'rgba(99,102,241,0.2)';
          };
          // Favicon
          let domain = '';
          try { domain = new URL(cit.url).hostname.replace('www.', ''); } catch(e) { domain = cit.url; }
          const favicon = document.createElement('img');
          favicon.src = `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
          favicon.style.cssText = 'width:16px;height:16px;border-radius:3px;flex-shrink:0;opacity:0.85;';
          favicon.onerror = () => { favicon.style.display = 'none'; };
          const textCol = document.createElement('div');
          textCol.style.cssText = 'flex:1;min-width:0;';
          const titleEl = document.createElement('div');
          titleEl.style.cssText = 'font-size:12.5px;font-weight:600;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
          titleEl.textContent = cit.title || domain;
          const urlEl = document.createElement('div');
          urlEl.style.cssText = 'font-size:11px;color:rgba(165,180,252,0.6);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px;';
          urlEl.textContent = cit.url;
          textCol.appendChild(titleEl);
          textCol.appendChild(urlEl);
          const numBadge = document.createElement('span');
          numBadge.style.cssText = 'font-size:10px;font-weight:700;color:rgba(165,180,252,0.5);flex-shrink:0;';
          numBadge.textContent = `[${idx + 1}]`;
          const arrowIcon = document.createElement('span');
          arrowIcon.style.cssText = 'color:rgba(165,180,252,0.4);font-size:13px;flex-shrink:0;';
          arrowIcon.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;
          card.appendChild(favicon);
          card.appendChild(textCol);
          card.appendChild(numBadge);
          card.appendChild(arrowIcon);
          citGrid.appendChild(card);
        });
        citBar.appendChild(citGrid);
        bubble.appendChild(citBar);
      }
      setTimeout(() => {
        if (typeof MathJax !== 'undefined' && MathJax.typesetPromise)
          MathJax.typesetPromise([bubble]).catch(()=>{});
      }, 100);

      // ── Action bar ────────────────────────────────────────────────
      const actions = document.createElement('div');
      actions.className = 'msg-actions';
      const ICON_COPY  = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
      const ICON_CHECK = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;
      const ICON_UP    = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88Z"/></svg>`;
      const ICON_DOWN  = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22h0a3.13 3.13 0 0 1-3-3.88Z"/></svg>`;
      const ICON_REGEN = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>`;
      const ICON_PREV  = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>`;
      const ICON_NEXT  = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`;

      function makeBtn(icon, title, cls) {
        const b = document.createElement('button');
        b.className = cls || 'msg-action-btn';
        b.title = title;
        b.innerHTML = icon;
        return b;
      }

      // Copy
      const copyBtn = makeBtn(ICON_COPY, 'Copy');
      copyBtn.addEventListener('click', () => {
        const contentEl = bubble.querySelector('.ai-content') || bubble;
        const tmp = document.createElement('div');
        tmp.innerHTML = contentEl.innerHTML;
        navigator.clipboard.writeText(tmp.textContent.trim()).catch(() => {});
        copyBtn.innerHTML = ICON_CHECK;
        copyBtn.classList.add('copied');
        setTimeout(() => { copyBtn.innerHTML = ICON_COPY; copyBtn.classList.remove('copied'); }, 1800);
      });
      // Thumbs up
      const upBtn = makeBtn(ICON_UP, 'Good response');
      upBtn.addEventListener('click', () => {
        upBtn.classList.toggle('active-good');
        downBtn.classList.remove('active-bad');
      });
      // Thumbs down
      const downBtn = makeBtn(ICON_DOWN, 'Bad response');
      downBtn.addEventListener('click', () => {
        downBtn.classList.toggle('active-bad');
        upBtn.classList.remove('active-good');
      });
      // Sep
      const sep = document.createElement('div');
      sep.className = 'msg-actions-sep';

      // ── Regen version navigation ──────────────────────────────────
      // Each AI message stores a versions array: [{html, source}]
      div._regenVersions = [{ html: (bubble.querySelector('.ai-content') || bubble).innerHTML, source }];
      div._regenIdx = 0;

      const regenNav = document.createElement('div');
      regenNav.className = 'regen-nav';
      const prevBtn  = makeBtn(ICON_PREV,  'Previous version', 'regen-nav-btn');
      const navLabel = document.createElement('span');
      navLabel.className = 'regen-nav-label';
      navLabel.textContent = '1/1';
      const nextBtn  = makeBtn(ICON_NEXT,  'Next version', 'regen-nav-btn');

      function updateRegenNav() {
        const total = div._regenVersions.length;
        const idx   = div._regenIdx;
        navLabel.textContent = `${idx + 1}/${total}`;
        prevBtn.style.opacity = idx === 0 ? '0.3' : '1';
        nextBtn.style.opacity = idx === total - 1 ? '0.3' : '1';
        regenNav.style.display = total > 1 ? 'flex' : 'none';
      }
      updateRegenNav();

      prevBtn.addEventListener('click', () => {
        if (div._regenIdx > 0) {
          div._regenIdx--;
          const c = bubble.querySelector('.ai-content') || bubble;
          c.innerHTML = div._regenVersions[div._regenIdx].html;
          updateRegenNav();
        }
      });
      nextBtn.addEventListener('click', () => {
        if (div._regenIdx < div._regenVersions.length - 1) {
          div._regenIdx++;
          const c = bubble.querySelector('.ai-content') || bubble;
          c.innerHTML = div._regenVersions[div._regenIdx].html;
          updateRegenNav();
        }
      });
      regenNav.appendChild(prevBtn);
      regenNav.appendChild(navLabel);
      regenNav.appendChild(nextBtn);

      // Regen button — removes THIS AI message, then resends the last user question
      const regenBtn = makeBtn(ICON_REGEN, 'Regenerate');
      regenBtn.addEventListener('click', () => {
        // Find the user message immediately before this AI message
        let prev = div.previousElementSibling;
        while (prev && !(prev.classList.contains('message') && prev.classList.contains('user'))) {
          prev = prev.previousElementSibling;
        }
        if (!prev) return;
        const q = prev.querySelector('.message-bubble')?.textContent?.trim();
        if (!q) return;

        // Keep this AI message in DOM and push new regen into its version history
        window._regenTargetMsg = div;

        regenBtn.style.transition = 'transform 0.5s ease';
        regenBtn.style.transform = 'rotate(360deg)';
        setTimeout(() => { regenBtn.style.transform = ''; }, 500);

        document.getElementById('chat-input').value = q;
        sendMessage();
      });

      actions.appendChild(copyBtn);
      actions.appendChild(upBtn);
      actions.appendChild(downBtn);
      actions.appendChild(sep);
      actions.appendChild(regenBtn);
      actions.appendChild(regenNav);

      // ── Save to Study Deck ────────────────────────────────────────
      const saveSep = document.createElement('div');
      saveSep.className = 'msg-actions-sep';
      const ICON_STAR  = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/></svg>`;
      const ICON_BRAIN = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"/><path d="M17.599 6.5a3 3 0 0 0 .399-1.375"/><path d="M6.003 5.125A3 3 0 0 0 6.401 6.5"/><path d="M3.477 10.896a4 4 0 0 1 .585-.396"/><path d="M19.938 10.5a4 4 0 0 1 .585.396"/><path d="M6 18a4 4 0 0 1-1.967-.516"/><path d="M19.967 17.484A4 4 0 0 1 18 18"/></svg>`;
      const ICON_NOTE  = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>`;

      function makeSaveBtn(icon, label, colorVar) {
        const b = document.createElement('button');
        b.className = 'msg-save-btn';
        b.title = label;
        b.innerHTML = icon + '<span>' + label + '</span>';
        b.style.setProperty('--save-color', colorVar);
        return b;
      }

      const saveExplBtn  = makeSaveBtn(ICON_STAR,  '⭐ Save',        '#f59e0b');
      const addCardBtn   = makeSaveBtn(ICON_BRAIN, '🧠 Flashcard',   '#a855f7');
      const saveNoteBtn  = makeSaveBtn(ICON_NOTE,  '📝 Note',        '#10b981');

      // Save explanation to localStorage notes
      saveExplBtn.addEventListener('click', () => {
        const contentEl = bubble.querySelector('.ai-content') || bubble;
        const txt = contentEl.innerText.trim().slice(0, 1200);
        const notes = JSON.parse(localStorage.getItem('chunks_saved_notes') || '[]');
        notes.unshift({ type:'explanation', text: txt, ts: Date.now(), exam: (window._sfState||window.sfState||{}).examName||'' });
        if (notes.length > 100) notes.pop();
        localStorage.setItem('chunks_saved_notes', JSON.stringify(notes));
        saveExplBtn.innerHTML = ICON_STAR + '<span>Saved ✓</span>';
        saveExplBtn.style.color = '#f59e0b';
        saveExplBtn.style.borderColor = 'rgba(245,158,11,0.3)';
        setTimeout(() => { saveExplBtn.innerHTML = ICON_STAR + '<span>⭐ Save</span>'; saveExplBtn.style.color=''; saveExplBtn.style.borderColor=''; }, 2000);
      });

      // Add to flashcards — sends a follow-up to generate a card from this answer
      addCardBtn.addEventListener('click', () => {
        const contentEl = bubble.querySelector('.ai-content') || bubble;
        const txt = contentEl.innerText.trim().slice(0, 600);
        const prompt = 'Turn this explanation into 3 concise flashcards (front: question, back: answer):\n\n' + txt;
        document.getElementById('chat-input').value = prompt;
        if (typeof sendMessage === 'function') sendMessage();
        addCardBtn.innerHTML = ICON_BRAIN + '<span>Sending…</span>';
        setTimeout(() => { addCardBtn.innerHTML = ICON_BRAIN + '<span>🧠 Flashcard</span>'; }, 2000);
      });

      // Save as note
      saveNoteBtn.addEventListener('click', () => {
        const contentEl = bubble.querySelector('.ai-content') || bubble;
        const txt = contentEl.innerText.trim().slice(0, 1200);
        const notes = JSON.parse(localStorage.getItem('chunks_saved_notes') || '[]');
        notes.unshift({ type:'note', text: txt, ts: Date.now(), exam: (window._sfState||window.sfState||{}).examName||'' });
        if (notes.length > 100) notes.pop();
        localStorage.setItem('chunks_saved_notes', JSON.stringify(notes));
        saveNoteBtn.innerHTML = ICON_NOTE + '<span>Saved ✓</span>';
        saveNoteBtn.style.color = '#10b981';
        saveNoteBtn.style.borderColor = 'rgba(16,185,129,0.3)';
        setTimeout(() => { saveNoteBtn.innerHTML = ICON_NOTE + '<span>📝 Note</span>'; saveNoteBtn.style.color=''; saveNoteBtn.style.borderColor=''; }, 2000);
      });

      // Only show save deck for real AI answers (not short system messages)
      const isRealAnswer = text.length > 80 && !text.startsWith('🔒') && !text.startsWith('✅') && !text.startsWith('⚠️');
      if (isRealAnswer) {
        actions.appendChild(saveSep);
        actions.appendChild(saveExplBtn);
        actions.appendChild(addCardBtn);
        actions.appendChild(saveNoteBtn);
      }

      div.appendChild(bubble);
      div.appendChild(actions);
    }

    chat.insertBefore(div, typing);
    chat.scrollTop = chat.scrollHeight;
    limitChatMessages();
    saveChatHistory();
  }

  function formatAIResponse(text) {
    if (!text) return '';

    // 1. Protect page citations — use null-byte delimiters to avoid markdown collision
    text = text.replace(/📖\s*Page\s*(\d+)/g, (_, p) => `\x00PAGECITE_${p}\x00`);

    // 2. Process fenced code blocks (``` ... ```) before anything else
    const codeBlocks = [];
    text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      const idx = codeBlocks.length;
      const langLabel = lang ? `<span style="font-size:11px;color:#a5b4fc;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;">${escapeHtml(lang)}</span>` : '<span style="font-size:11px;color:rgba(255,255,255,0.3);font-weight:600;">code</span>';
      const escapedCode = escapeHtml(code.trimEnd());
      // Copy button with data-code attribute (encoded)
      const copyId = `cb_${Math.random().toString(36).slice(2,8)}`;
      codeBlocks.push(`<div style="position:relative;margin:16px 0;border-radius:10px;overflow:hidden;border:1px solid rgba(255,255,255,0.1);"><div style="display:flex;align-items:center;justify-content:space-between;padding:8px 16px;background:rgba(0,0,0,0.45);border-bottom:1px solid rgba(255,255,255,0.07);">${langLabel}<button id="${copyId}" onclick="(function(btn){const pre=btn.closest('div[style]').querySelector('code');navigator.clipboard.writeText(pre?pre.innerText:'').catch(()=>{});btn.textContent='Copied!';btn.style.color='#4ade80';setTimeout(()=>{btn.textContent='Copy';btn.style.color='';},1800);})(this)" style="background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.12);border-radius:5px;color:rgba(255,255,255,0.5);font-size:11px;font-weight:600;padding:3px 10px;cursor:pointer;font-family:inherit;transition:all 0.15s;" onmouseover="this.style.background='rgba(255,255,255,0.13)';this.style.color='rgba(255,255,255,0.85)'" onmouseout="this.style.background='rgba(255,255,255,0.07)';this.style.color='rgba(255,255,255,0.5)'">Copy</button></div><pre style="background:rgba(0,0,0,0.38);padding:14px 18px;overflow-x:auto;font-family:'Courier New',monospace;font-size:13px;line-height:1.65;color:#e2e8f0;margin:0;"><code>${escapedCode}</code></pre></div>`);
      return `\x00CODE_${idx}\x00`;
    });

    // 3. Process inline code (` ... `) before line processing
    const inlineCodes = [];
    text = text.replace(/`([^`\n]+)`/g, (_, code) => {
      const idx = inlineCodes.length;
      inlineCodes.push(`<code style="background:rgba(102,126,234,0.18);padding:2px 7px;border-radius:5px;font-family:'Courier New',monospace;font-size:0.88em;color:#c4b5fd;">${escapeHtml(code)}</code>`);
      return `\x00ICODE_${idx}\x00`;
    });

    // 4. Split into lines for block-level parsing
    const lines = text.split('\n');
    let html = '';
    let i = 0;

    function applyInline(str) {
      // Bold+italic
      str = str.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
      // Bold (** only — avoid __ to prevent conflict with __CODE_N__ placeholders)
      str = str.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      // Italic
      str = str.replace(/\*([^*\n]+?)\*/g, '<em>$1</em>');
      str = str.replace(/_([^_\n]+?)_/g, '<em>$1</em>');
      // Strikethrough
      str = str.replace(/~~(.+?)~~/g, '<del>$1</del>');
      return str;
    }

    function isTableRow(line) {
      return line.trim().startsWith('|') && line.trim().endsWith('|') && line.includes('|', 1);
    }

    function isSeparatorRow(line) {
      return /^\|[\s\-:|]+\|/.test(line.trim());
    }

    function parseTableRow(line) {
      return line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
    }

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      // Skip blank lines (handled between blocks)
      if (trimmed === '') {
        i++;
        continue;
      }

      // Headings
      if (/^#{1,6} /.test(trimmed)) {
        const level = trimmed.match(/^(#{1,6}) /)[1].length;
        const content = trimmed.replace(/^#{1,6} /, '');
        const tag = level <= 2 ? 'h3' : 'h4';
        const style = level <= 2
          ? 'color:#c4b5fd;font-size:16px;font-weight:700;margin:20px 0 10px 0;letter-spacing:-0.02em;line-height:1.4;'
          : 'color:#a5b4fc;font-size:14.5px;font-weight:600;margin:16px 0 8px 0;letter-spacing:-0.01em;';
        html += `<${tag} style="${style}">${applyInline(content)}</${tag}>`;
        i++;
        continue;
      }

      // Horizontal rule
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
        html += '<hr style="border:none;border-top:1px solid rgba(255,255,255,0.1);margin:16px 0;">';
        i++;
        continue;
      }

      // Blockquote
      if (trimmed.startsWith('> ')) {
        let qLines = [];
        while (i < lines.length && lines[i].trim().startsWith('> ')) {
          qLines.push(lines[i].trim().replace(/^> /, ''));
          i++;
        }
        html += `<blockquote style="margin:12px 0;padding:10px 16px;background:rgba(102,126,234,0.1);border-left:4px solid #667eea;border-radius:4px;color:rgba(255,255,255,0.8);">${applyInline(qLines.join('<br>'))}</blockquote>`;
        continue;
      }

      // Table detection
      if (isTableRow(trimmed)) {
        const tableLines = [];
        while (i < lines.length) {
          const tl = lines[i].trim();
          if (isTableRow(tl) || isSeparatorRow(tl)) {
            tableLines.push(lines[i]);
            i++;
          } else if (tl === '' && tableLines.length > 0 && i + 1 < lines.length && isTableRow(lines[i+1].trim())) {
            // Skip lone blank line inside a table block (some AI models emit these)
            i++;
          } else {
            break;
          }
        }
        // Parse header / separator / rows
        const rows = tableLines.filter(l => !isSeparatorRow(l));
        const hasHeader = tableLines.length > 1 && tableLines.slice(1, 3).some(l => isSeparatorRow(l));
        let tableHtml = '<div class="md-table-wrap"><table>';
        if (hasHeader && rows.length > 0) {
          const headers = parseTableRow(rows[0]);
          tableHtml += '<thead><tr>' + headers.map(h => `<th>${applyInline(h)}</th>`).join('') + '</tr></thead>';
          tableHtml += '<tbody>';
          for (let r = 1; r < rows.length; r++) {
            const cells = parseTableRow(rows[r]);
            tableHtml += '<tr>' + cells.map(c => `<td>${applyInline(c)}</td>`).join('') + '</tr>';
          }
          tableHtml += '</tbody>';
        } else {
          tableHtml += '<tbody>';
          for (const row of rows) {
            const cells = parseTableRow(row);
            tableHtml += '<tr>' + cells.map(c => `<td>${applyInline(c)}</td>`).join('') + '</tr>';
          }
          tableHtml += '</tbody>';
        }
        tableHtml += '</table></div>';
        html += tableHtml;
        continue;
      }

      // Unordered list
      if (/^[\-\*•] /.test(trimmed)) {
        let items = [];
        while (i < lines.length && /^[\-\*•] /.test(lines[i].trim())) {
          items.push(lines[i].trim().replace(/^[\-\*•] /, ''));
          i++;
        }
        html += '<ul style="margin:8px 0 12px 0;padding-left:22px;">' +
          items.map(it => `<li style="margin:5px 0;line-height:1.75;">${applyInline(it)}</li>`).join('') +
          '</ul>';
        continue;
      }

      // Ordered list
      if (/^\d+\. /.test(trimmed)) {
        let items = [];
        while (i < lines.length && /^\d+\. /.test(lines[i].trim())) {
          items.push(lines[i].trim().replace(/^\d+\. /, ''));
          i++;
        }
        html += '<ol style="margin:8px 0 12px 0;padding-left:22px;">' +
          items.map(it => `<li style="margin:5px 0;line-height:1.75;">${applyInline(it)}</li>`).join('') +
          '</ol>';
        continue;
      }

      // Regular paragraph - collect consecutive non-block lines
      let paraLines = [];
      while (i < lines.length) {
        const l = lines[i];
        const t = l.trim();
        if (t === '') { i++; break; }
        if (/^#{1,6} /.test(t) || /^(-{3,}|\*{3,}|_{3,})$/.test(t) ||
            t.startsWith('> ') || isTableRow(t) ||
            /^[\-\*•] /.test(t) || /^\d+\. /.test(t) ||
            t.includes('\x00CODE_')) {
          break;
        }
        paraLines.push(t);
        i++;
      }
      if (paraLines.length > 0) {
        html += `<p style="margin:0 0 12px 0;line-height:1.82;">${applyInline(paraLines.join('<br>'))}</p>`;
      }
    }

    // 5. Restore code blocks and inline codes
    codeBlocks.forEach((block, idx) => { html = html.split(`\x00CODE_${idx}\x00`).join(block); });
    inlineCodes.forEach((code, idx) => { html = html.split(`\x00ICODE_${idx}\x00`).join(code); });

    // 6. Restore page citations
    html = html.replace(/\x00PAGECITE_(\d+)\x00/g, (_, p) =>
      `<span class="inline-page-cite" onclick="if(typeof jumpToPage==='function')jumpToPage(${p})" title="Jump to page ${p}" style="cursor:pointer;background:rgba(129,140,248,0.15);border:1px solid rgba(129,140,248,0.35);border-radius:6px;padding:2px 8px;font-size:11px;font-weight:700;color:#a5b4fc;white-space:nowrap;display:inline-block;margin:0 2px;transition:all 0.15s;animation:citePop 0.3s ease both;" onmouseover="this.style.background='rgba(129,140,248,0.28)';this.style.borderColor='rgba(129,140,248,0.6)'" onmouseout="this.style.background='rgba(129,140,248,0.15)';this.style.borderColor='rgba(129,140,248,0.35)'">📖 Page ${p}</span>`
    );

    return html;
  }



  function clearChat() {
    // Confirm before clearing
    if (confirm('Clear all chat messages? This cannot be undone.')) {
      const chat = document.getElementById('chat-messages');
      const typing = document.getElementById('typing-indicator');
      
      // Remove all messages except typing indicator
      const messages = chat.querySelectorAll('.message');
      messages.forEach(msg => msg.remove());
      
      // Add temporary cleared message, then replace with welcome
      addChatMessage('Chat cleared! Ask me anything about your textbook.', 'ai');

      // After 2.5s, fade it out and replace with welcome message
      setTimeout(() => {
        const chat = document.getElementById('chat-messages');
        const msgs = chat.querySelectorAll('.message.ai');
        const lastMsg = msgs[msgs.length - 1];
        if (lastMsg) {
          lastMsg.style.transition = 'opacity 0.5s';
          lastMsg.style.opacity = '0';
          setTimeout(() => {
            lastMsg.remove();
            addChatMessage('Welcome back! What would you like to explore today?', 'ai');
          }, 500);
        }
      }, 2500);
    }
  }

  function limitChatMessages(maxMessages = 50) {
    const chat = document.getElementById('chat-messages');
    const messages = chat.querySelectorAll('.message');
    
    // If more than maxMessages, remove oldest ones
    if (messages.length > maxMessages) {
      const toRemove = messages.length - maxMessages;
      for (let i = 0; i < toRemove; i++) {
        messages[i].remove();
      }
    }
  }

  let currentZoom = 1.0;

  function zoomIn() {
    if (currentZoom >= 3) return;
    currentZoom += 0.25;
    scale = currentZoom;
    document.getElementById('zoom-level').textContent = Math.round(currentZoom * 100) + '%';
    reRenderAllPages();
  }

  function zoomOut() {
    if (currentZoom <= 0.5) return;
    currentZoom -= 0.25;
    scale = currentZoom;
    document.getElementById('zoom-level').textContent = Math.round(currentZoom * 100) + '%';
    reRenderAllPages();
  }

  function fitToWidth() {
    const viewer = document.getElementById('pdf-viewer');
    const viewerWidth = viewer.clientWidth - 40;
    if (pdfDoc) {
      pdfDoc.getPage(1).then(page => {
        const viewport = page.getViewport({ scale: 1 });
        currentZoom = viewerWidth / viewport.width;
        scale = currentZoom;
        document.getElementById('zoom-level').textContent = Math.round(currentZoom * 100) + '%';
        reRenderAllPages();
      });
    }
  }

  async function reRenderAllPages() {
    if (!pdfDoc) return;
    const container = document.getElementById('pdf-pages-container');
    if (!container) return;
    container.innerHTML = '';
    renderedPages.clear();
    for (let i = 1; i <= Math.min(3, pdfDoc.numPages); i++) {
      await renderPageScroll(i);
    }
  }

  function previousPageScroll() {
    if (currentPage > 1) {
      jumpToPage(currentPage - 1);
    }
  }

  function nextPageScroll() {
    if (currentPage < pdfDoc.numPages) {
      jumpToPage(currentPage + 1);
    }
  }

  function goToPageInput() {
    const input = document.getElementById('page-input');
    const pageNumber = parseInt(input.value);
    if (!pdfDoc) {
      _showToast('📚 Please select a book from the library first!');
      input.value = currentPage;
      return;
    }
    if (pageNumber >= 1 && pageNumber <= pdfDoc.numPages) {
      jumpToPage(pageNumber);
      input.blur();
    } else {
      _showToast(`📄 Enter a page between 1 and ${pdfDoc.numPages}`);
      input.value = currentPage;
    }
  }

  function searchPDF() {
    const overlay = document.getElementById('search-overlay');
    overlay.classList.toggle('active');
    if (overlay.classList.contains('active')) {
      document.getElementById('search-input').focus();
    } else {
      document.getElementById('search-input').value = '';
      document.getElementById('search-results').textContent = '';
      clearSearchHighlights();
    }
  }

  let _searchMatches = [];
  let _searchIndex = -1;

  function handleSearch(event) {
    const searchTerm = event.target.value.toLowerCase().trim();
    const results = document.getElementById('search-results');
    const prevBtn = document.getElementById('search-prev-btn');
    const nextBtn = document.getElementById('search-next-btn');

    if (searchTerm.length < 2) {
      results.textContent = '';
      clearSearchHighlights();
      _searchMatches = [];
      _searchIndex = -1;
      if (prevBtn) prevBtn.disabled = true;
      if (nextBtn) nextBtn.disabled = true;
      return;
    }

    clearSearchHighlights();
    _searchMatches = [];
    _searchIndex = -1;

    document.querySelectorAll('.pdf-text-layer span').forEach(span => {
      const text = (span.dataset.text || span.textContent || '').toLowerCase();
      if (text.includes(searchTerm)) {
        span.style.background = 'rgba(255, 213, 0, 0.45)';
        span.style.borderRadius = '2px';
        span.style.outline = '2px solid rgba(255, 180, 0, 0.6)';
        span.classList.add('pdf-search-highlight');
        _searchMatches.push(span);
      }
    });

    if (_searchMatches.length > 0) {
      _searchIndex = 0;
      _scrollToMatch(0);
      results.textContent = `1 / ${_searchMatches.length} matches`;
      results.style.color = '#4ade80';
      if (prevBtn) prevBtn.disabled = false;
      if (nextBtn) nextBtn.disabled = false;
    } else {
      results.textContent = 'No results';
      results.style.color = 'rgba(255,255,255,0.4)';
      if (prevBtn) prevBtn.disabled = true;
      if (nextBtn) nextBtn.disabled = true;
    }
  }

  function _scrollToMatch(index) {
    // Dim all, highlight current
    _searchMatches.forEach((el, i) => {
      el.style.background = i === index ? 'rgba(255, 180, 0, 0.85)' : 'rgba(255, 213, 0, 0.45)';
      el.style.outline = i === index ? '2px solid rgba(255, 140, 0, 1)' : '2px solid rgba(255, 180, 0, 0.6)';
    });
    _searchMatches[index].scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function navigateSearch(dir) {
    if (_searchMatches.length === 0) return;
    _searchIndex = (_searchIndex + dir + _searchMatches.length) % _searchMatches.length;
    _scrollToMatch(_searchIndex);
    const results = document.getElementById('search-results');
    if (results) results.textContent = `${_searchIndex + 1} / ${_searchMatches.length} matches`;
  }

  function clearSearchHighlights() {
    document.querySelectorAll('.pdf-search-highlight').forEach(el => {
      el.style.background = 'transparent';
      el.style.outline = 'none';
      el.classList.remove('pdf-search-highlight');
    });
    _searchMatches = [];
    _searchIndex = -1;
  }

  function printPDF() {
    if (!pdfDoc) {
      _showToast('📚 Please select a book from the library first!');
      return;
    }
    window.print();
  }

  function downloadPDF() {
    const savedPDF = localStorage.getItem('eightysix_pdf_data');
    const savedName = localStorage.getItem('eightysix_pdf_name');
    if (!savedPDF) {
      _showToast('📄 No PDF loaded!');
      return;
    }
    const link = document.createElement('a');
    link.href = savedPDF;
    link.download = savedName || 'textbook.pdf';
    link.click();
  }

  function updatePageInput() {
    const input = document.getElementById('page-input');
    const total = document.getElementById('page-total');
    if (input) input.value = currentPage;
    if (total && pdfDoc) total.textContent = pdfDoc.numPages;
    const prevBtn = document.getElementById('prev-page-btn');
    const nextBtn = document.getElementById('next-page-btn');
    if (prevBtn) prevBtn.disabled = currentPage <= 1;
    if (nextBtn) nextBtn.disabled = currentPage >= pdfDoc.numPages;
  }

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      searchPDF();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
      e.preventDefault();
      printPDF();
    }
    if (!['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
      if (e.key === 'ArrowLeft') {
        previousPageScroll();
      } else if (e.key === 'ArrowRight') {
        nextPageScroll();
      }
    }
    if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      zoomIn();
    } else if (e.key === '-') {
      e.preventDefault();
      zoomOut();
    }
  });

  // CHAT HISTORY MANAGEMENT
  let currentChatId = null;
  let chatSessions = {};

  // ── PDF IndexedDB Cache ────────────────────────────────
  const IDB_NAME = 'chunks_pdf_cache', IDB_STORE = 'pdfs', IDB_VER = 1;

  function idbOpen() {
    return new Promise((res, rej) => {
      const req = indexedDB.open(IDB_NAME, IDB_VER);
      req.onupgradeneeded = e => e.target.result.createObjectStore(IDB_STORE);
      req.onsuccess = e => res(e.target.result);
      req.onerror   = e => rej(e.target.error);
    });
  }

  async function idbSavePDF(name, arrayBuffer) {
    const db = await idbOpen();
    return new Promise((res, rej) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put({ name, buffer: arrayBuffer, ts: Date.now() }, 'last_uploaded');
      tx.oncomplete = res; tx.onerror = e => rej(e.target.error);
    });
  }

  async function idbGetPDF() {
    const db = await idbOpen();
    return new Promise((res, rej) => {
      const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get('last_uploaded');
      req.onsuccess = e => res(e.target.result || null);
      req.onerror   = e => rej(e.target.error);
    });
  }

  async function idbClearPDF() {
    try {
      const db = await idbOpen();
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete('last_uploaded');
    } catch(e) {}
  }

  // Restore a cached uploaded PDF (only local uploads — library books load from server)
  async function tryRestoreUploadedPDF() {
    try {
      const stored = await idbGetPDF();
      if (!stored || !stored.buffer) return;
      // Only restore if a local book was active last session
      const lastBook = localStorage.getItem('eightysix_current_book') || '';
      if (!lastBook.startsWith('local_')) return;
      const typedarray = new Uint8Array(stored.buffer);
      pdfDoc = await pdfjsLib.getDocument({ data: typedarray }).promise;
      currentPdfName = stored.name.replace(/\.pdf$/i, '');
      // Show the main container
      document.getElementById('welcome-screen').classList.add('hidden');
      document.getElementById('main-header').classList.add('active');
      document.getElementById('main-container').classList.add('active');
      document.getElementById('page-total').textContent = pdfDoc.numPages;
      const placeholder = document.querySelector('.pdf-placeholder');
      if (placeholder) placeholder.style.display = 'none';
      const viewer = document.getElementById('pdf-viewer');
      viewer.innerHTML = '';
      renderedPages.clear();
      const pagesContainer = document.createElement('div');
      pagesContainer.id = 'pdf-pages-container';
      pagesContainer.style.cssText = 'display:flex;flex-direction:column;gap:20px;padding:20px;align-items:center;width:100%;';
      viewer.appendChild(pagesContainer);
      for (let i = 1; i <= Math.min(3, pdfDoc.numPages); i++) await renderPageScroll(i);
      // Update placeholder and close btn
      const chatInput = document.getElementById('chat-input');
      if (chatInput) {
        const sn = currentPdfName.length > 30 ? currentPdfName.substring(0,27)+'…' : currentPdfName;
        chatInput.placeholder = `Ask about ${sn}…`;
      }
      const closeBtn = document.getElementById('close-book-btn');
      if (closeBtn) closeBtn.style.display = '';
      _showToast(`Restored: ${currentPdfName}`);
    } catch(e) {
      console.warn('PDF restore failed:', e);
    }
  }

  window.addEventListener('load', () => {
    loadChatSessions();
    displayChatHistory();
    // Restore locally-uploaded PDF if one was active last session
    tryRestoreUploadedPDF().catch(() => {});
    // Restore the last open chat so refresh keeps you on the same page.
    // sessionStorage clears on browser close, so this only runs on refresh.
    try {
      const lastChatId  = sessionStorage.getItem('chunks_last_chat_id');
      const generalMode = sessionStorage.getItem('chunks_general_mode') === '1';
      if (lastChatId || generalMode) {
        // Helper: reveal welcome as fallback if session was never found
        function _fallbackToWelcome() {
          var noFlash = document.getElementById('__no-flash');
          if (noFlash) noFlash.remove();
          try { sessionStorage.removeItem('chunks_last_chat_id'); } catch(e) {}
          const ws = document.getElementById('welcome-screen');
          if (ws) ws.classList.remove('hidden');
        }

        setTimeout(() => {
          if (lastChatId && chatSessions[lastChatId]) {
            loadChat(lastChatId);
            if (generalMode) {
              const mc = document.getElementById('main-container');
              if (mc) mc.classList.add('chat-fullscreen');
              window._generalChatMode = true; try { sessionStorage.setItem('chunks_general_mode', '1'); } catch(e) {}
            }
          } else if (generalMode) {
            document.getElementById('welcome-screen').classList.add('hidden');
            const mh = document.getElementById('main-header');
            if (mh) { mh.classList.add('active'); mh.style.display = 'flex'; }
            const mc = document.getElementById('main-container');
            if (mc) { mc.classList.add('active'); mc.style.display = 'flex'; mc.classList.add('chat-fullscreen'); }
            window._generalChatMode = true; try { sessionStorage.setItem('chunks_general_mode', '1'); } catch(e) {}
            var noFlash = document.getElementById('__no-flash');
            if (noFlash) noFlash.remove();
            if (typeof createNewChat === 'function') createNewChat();
          } else {
            // Session not in localStorage yet — try once more after Supabase sync
            setTimeout(() => {
              if (lastChatId && chatSessions[lastChatId]) {
                loadChat(lastChatId);
                if (generalMode) {
                  const mc = document.getElementById('main-container');
                  if (mc) mc.classList.add('chat-fullscreen');
                  window._generalChatMode = true; try { sessionStorage.setItem('chunks_general_mode', '1'); } catch(e) {}
                }
              } else {
                // Session truly not found after 2 attempts — show welcome so
                // user isn't stuck on a blank screen forever
                _fallbackToWelcome();
              }
            }, 800);
          }
        }, 600);
      }
    } catch(e) {}
  });

  function toggleChatHistory() {
    const sidebar = document.getElementById('chat-history-sidebar');
    const isOpen = sidebar.classList.contains('open') || sidebar.classList.contains('hover-open');
    if (isOpen) {
      sidebar.classList.remove('open');
      sidebar.classList.remove('hover-open');
    } else {
      sidebar.classList.add('open');
    }
  }

  // Hover-to-open sidebar
  (function() {
    const trigger = document.getElementById('sidebar-hover-trigger');
    const sidebar = document.getElementById('chat-history-sidebar');
    let closeTimer = null;

    function openSidebar() {
      clearTimeout(closeTimer);
      sidebar.classList.add('hover-open');
    }

    function schedulClose() {
      closeTimer = setTimeout(() => {
        if (!sidebar.classList.contains('open')) {
          sidebar.classList.remove('hover-open');
        }
      }, 200);
    }

    trigger.addEventListener('mouseenter', openSidebar);
    sidebar.addEventListener('mouseenter', openSidebar);
    sidebar.addEventListener('mouseleave', schedulClose);
  })();

  function createNewChat() {
    // Always reset to Study mode for a fresh chat — don't carry over Exam/Practice from last session
    if (currentStudyMode !== 'study') {
      setMode('study');
    }
    // If the current chat is empty (no user messages), reuse it instead of creating a new one.
    // This prevents empty chats from stacking up in the sidebar.
    if (currentChatId) {
      const existing = chatSessions[currentChatId];
      const hasUserMsg = existing && existing.messages && existing.messages.some(m => m.sender === 'user');
      if (!hasUserMsg) {
        // Reuse the existing empty chat — just clear the UI and update the session state
        const chat = document.getElementById('chat-messages');
        const typing = document.getElementById('typing-indicator');
        chat.innerHTML = '';
        chat.appendChild(typing);
        const welcomeMsg = pdfDoc
          ? '<svg width="18" height="18" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;margin-right:6px;flex-shrink:0;"><defs><linearGradient id="wbO1" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#667eea"/><stop offset="100%" stop-color="#a855f7"/></linearGradient><linearGradient id="wbO2" x1="100%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#764ba2"/><stop offset="100%" stop-color="#667eea"/></linearGradient></defs><ellipse cx="50" cy="50" rx="42" ry="14" fill="none" stroke="url(#wbO1)" stroke-width="7" opacity="0.92"/><ellipse cx="50" cy="50" rx="42" ry="14" fill="none" stroke="url(#wbO2)" stroke-width="7" transform="rotate(60 50 50)" opacity="0.88"/><ellipse cx="50" cy="50" rx="42" ry="14" fill="none" stroke="url(#wbO1)" stroke-width="7" transform="rotate(120 50 50)" opacity="0.85"/><circle cx="50" cy="50" r="9" fill="#dcc8ff"/></svg>Welcome back! What would you like to explore today?'
          : '<svg width="18" height="18" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;margin-right:6px;flex-shrink:0;"><defs><linearGradient id="wcO1" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#667eea"/><stop offset="100%" stop-color="#a855f7"/></linearGradient><linearGradient id="wcO2" x1="100%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#764ba2"/><stop offset="100%" stop-color="#667eea"/></linearGradient></defs><ellipse cx="50" cy="50" rx="42" ry="14" fill="none" stroke="url(#wcO1)" stroke-width="7" opacity="0.92"/><ellipse cx="50" cy="50" rx="42" ry="14" fill="none" stroke="url(#wcO2)" stroke-width="7" transform="rotate(60 50 50)" opacity="0.88"/><ellipse cx="50" cy="50" rx="42" ry="14" fill="none" stroke="url(#wcO1)" stroke-width="7" transform="rotate(120 50 50)" opacity="0.85"/><circle cx="50" cy="50" r="9" fill="#dcc8ff"/></svg>Welcome to Chunks! Select a book from the library and ask questions.';
        addChatMessage(welcomeMsg, 'ai');
        try { sessionStorage.setItem('chunks_general_mode', window._generalChatMode ? '1' : '0'); } catch(e) {}
        // Ensure chat UI is visible even when reusing the existing empty chat — smooth fade
        const _ws = document.getElementById('welcome-screen');
        const _mh = document.getElementById('main-header');
        const _mc = document.getElementById('main-container');
        if (_ws) { _ws.classList.add('fading-out'); setTimeout(() => _ws.classList.add('hidden'), 280); }
        if (_mh) { _mh.classList.add('active'); _mh.style.display = 'flex'; }
        if (_mc) { _mc.classList.add('active'); _mc.style.display = 'flex'; }
        if (window.innerWidth < 768) toggleChatHistory();
        return; // Don't create a new chat
      }
      saveCurrentChat();
    }

    const chatId = 'chat_' + Date.now();
    currentChatId = chatId;
    // Persist so a refresh restores this chat
    try { sessionStorage.setItem('chunks_last_chat_id', chatId); } catch(e) {}
    // Persist general mode in sessionStorage (clears on browser close, survives refresh)
    try { sessionStorage.setItem('chunks_general_mode', window._generalChatMode ? '1' : '0'); } catch(e) {}

    // Don't save to chatSessions/sidebar until the user actually sends a message.
    // The chat is registered as a pending stub so sendMessage() can promote it.
    chatSessions[chatId] = {
      id: chatId,
      title: 'New Chat',
      messages: [],
      timestamp: Date.now(),
      mode: 'study',
      _empty: true  // flag: not yet saved to sidebar
    };

    const chat = document.getElementById('chat-messages');
    const typing = document.getElementById('typing-indicator');
    chat.innerHTML = '';
    chat.appendChild(typing);
    const welcomeMsg = pdfDoc
      ? '<svg width="18" height="18" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;margin-right:6px;flex-shrink:0;"><defs><linearGradient id="wbO1" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#667eea"/><stop offset="100%" stop-color="#a855f7"/></linearGradient><linearGradient id="wbO2" x1="100%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#764ba2"/><stop offset="100%" stop-color="#667eea"/></linearGradient></defs><ellipse cx="50" cy="50" rx="42" ry="14" fill="none" stroke="url(#wbO1)" stroke-width="7" opacity="0.92"/><ellipse cx="50" cy="50" rx="42" ry="14" fill="none" stroke="url(#wbO2)" stroke-width="7" transform="rotate(60 50 50)" opacity="0.88"/><ellipse cx="50" cy="50" rx="42" ry="14" fill="none" stroke="url(#wbO1)" stroke-width="7" transform="rotate(120 50 50)" opacity="0.85"/><circle cx="50" cy="50" r="9" fill="#dcc8ff"/></svg>Welcome back! What would you like to explore today?'
      : '<svg width="18" height="18" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;margin-right:6px;flex-shrink:0;"><defs><linearGradient id="wcO1" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#667eea"/><stop offset="100%" stop-color="#a855f7"/></linearGradient><linearGradient id="wcO2" x1="100%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#764ba2"/><stop offset="100%" stop-color="#667eea"/></linearGradient></defs><ellipse cx="50" cy="50" rx="42" ry="14" fill="none" stroke="url(#wcO1)" stroke-width="7" opacity="0.92"/><ellipse cx="50" cy="50" rx="42" ry="14" fill="none" stroke="url(#wcO2)" stroke-width="7" transform="rotate(60 50 50)" opacity="0.88"/><ellipse cx="50" cy="50" rx="42" ry="14" fill="none" stroke="url(#wcO1)" stroke-width="7" transform="rotate(120 50 50)" opacity="0.85"/><circle cx="50" cy="50" r="9" fill="#dcc8ff"/></svg>Welcome to Chunks! Select a book from the library and ask questions.';
    addChatMessage(welcomeMsg, 'ai');

    // Navigate away from welcome screen to the chat view — smooth fade
    const welcomeEl = document.getElementById('welcome-screen');
    const mainHeader = document.getElementById('main-header');
    const mainCont = document.getElementById('main-container');
    if (welcomeEl) {
      welcomeEl.classList.add('fading-out');
      setTimeout(() => welcomeEl.classList.add('hidden'), 280);
    }
    if (mainHeader) { mainHeader.classList.add('active'); mainHeader.style.display = 'flex'; }
    if (mainCont)   { mainCont.classList.add('active');   mainCont.style.display = 'flex'; }

    // Do NOT call saveChatSessions() or displayChatHistory() yet — wait for first user message
    if (window.innerWidth < 768) {
      toggleChatHistory();
    }
  }

  function loadChat(chatId) {
    if (currentChatId && currentChatId !== chatId) {
      saveCurrentChat();
    }
    currentChatId = chatId;
    // persist so refresh brings back the same chat
    try { sessionStorage.setItem('chunks_last_chat_id', chatId); } catch(e) {}
    // Remove the no-flash style tag — unhide main UI now that chat is ready
    var noFlash = document.getElementById('__no-flash');
    if (noFlash) noFlash.remove();
    const session = chatSessions[chatId];
    if (!session) {
      console.error('Chat not found:', chatId);
      return;
    }

    // Ensure main view is visible
    const welcomeScreen = document.getElementById('welcome-screen');
    const mainHeader = document.getElementById('main-header');
    const mainContainer = document.getElementById('main-container');
    if (welcomeScreen) {
      welcomeScreen.style.display = '';
      welcomeScreen.style.opacity = '';
      welcomeScreen.style.pointerEvents = '';
      welcomeScreen.classList.add('hidden');
    }
    mainHeader.classList.add('active');
    mainHeader.style.display = 'flex';
    mainContainer.classList.add('active');
    mainContainer.style.display = 'flex';

    const chat = document.getElementById('chat-messages');
    const typing = document.getElementById('typing-indicator');
    chat.innerHTML = '';
    chat.appendChild(typing);
    session.messages.forEach(msg => {
      const div = document.createElement('div');
      div.className = `message ${msg.sender}`;
      const bubble = document.createElement('div');
      bubble.className = 'message-bubble';
      bubble.innerHTML = msg.html;
      const pageRefs = bubble.querySelectorAll('.page-reference');
      pageRefs.forEach(ref => {
        const pageMatch = ref.textContent.match(/\d+/);
        if (pageMatch) {
          ref.onclick = () => jumpToPage(parseInt(pageMatch[0]));
        }
      });
      const flashcards = bubble.querySelectorAll('.mini-card');
      flashcards.forEach(card => {
        const id = card.id;
        if (id) {
          card.onclick = () => flipMiniCard(id.replace('mini-card-', ''));
        }
      });
      div.appendChild(bubble);
      chat.insertBefore(div, typing);
    });
    if (session.mode) {
      // Only restore 'study' and 'summary' modes - never auto-restore Exam/Practice
      // as these generate questions on every message which is unexpected behavior
      const safeToRestore = ['study', 'summary'];
      if (safeToRestore.includes(session.mode)) {
        setMode(session.mode);
      } else {
        setMode('study'); // reset to safe default
      }
    }
    chat.scrollTop = chat.scrollHeight;
    if (typeof MathJax !== 'undefined') {
      setTimeout(() => renderMath(chat), 100);
    }
    displayChatHistory();

    // Close sidebar after selecting a chat
    const sidebar = document.getElementById('chat-history-sidebar');
    sidebar.classList.remove('open');
    sidebar.classList.remove('hover-open');
  }

  function saveCurrentChat() {
    if (!currentChatId) return;
    const session = chatSessions[currentChatId];
    if (!session) return;
    // Don't persist empty/pending chats to sidebar until user sends a real message
    if (session._empty) return;
    const messages = [];
    document.querySelectorAll('.message').forEach(msg => {
      if (!msg.querySelector('.typing-indicator')) {
        const bubble = msg.querySelector('.message-bubble');
        messages.push({
          sender: msg.classList.contains('user') ? 'user' : 'ai',
          html: bubble ? bubble.innerHTML : msg.innerHTML
        });
      }
    });
    session.messages = messages;
    // Only set timestamp once (at creation), so newest chat stays on top
    if (!session.timestamp) session.timestamp = Date.now();
    if (messages.length > 0 && session.title === 'New Chat') {
      // Use the first user message immediately as the title — no need to wait for AI
      const firstUserMsg = messages.find(m => m.sender === 'user');
      const firstAiMsg  = messages.find(m => m.sender === 'ai');
      let autoTitle = '';
      if (firstUserMsg) {
        const tmpDiv = document.createElement('div');
        tmpDiv.innerHTML = firstUserMsg.html;
        const text = tmpDiv.textContent || tmpDiv.innerText;
        autoTitle = text.trim().substring(0, 42) + (text.trim().length > 42 ? '…' : '');
      }
      // Once AI responds, try to upgrade to a better heading-based title
      if (!autoTitle && firstAiMsg) {
        const tmpDiv = document.createElement('div');
        tmpDiv.innerHTML = firstAiMsg.html;
        const heading = tmpDiv.querySelector('h1,h2,h3,strong');
        if (heading && heading.textContent.trim().length > 3) {
          autoTitle = heading.textContent.trim().substring(0, 42);
        }
      }
      if (autoTitle) session.title = autoTitle;
    }
    session.mode = currentStudyMode;
    saveChatSessions();
    displayChatHistory();
  }


  function startChatRename(chatId) {
    const titleEl = document.getElementById('cht-title-' + chatId);
    const inputEl = document.getElementById('cht-input-' + chatId);
    if (!titleEl || !inputEl) return;
    inputEl.value = chatSessions[chatId]?.title || '';
    titleEl.style.display = 'none';
    inputEl.style.display = 'block';
    inputEl.focus();
    inputEl.select();
  }

  function finishChatRename(chatId) {
    const titleEl = document.getElementById('cht-title-' + chatId);
    const inputEl = document.getElementById('cht-input-' + chatId);
    if (!titleEl || !inputEl) return;
    const newTitle = inputEl.value.trim();
    if (newTitle && chatSessions[chatId]) {
      chatSessions[chatId].title = newTitle;
      saveChatSessions();
      titleEl.textContent = newTitle;
    }
    titleEl.style.display = '';
    inputEl.style.display = 'none';
  }

  function cancelChatRename(chatId) {
    const titleEl = document.getElementById('cht-title-' + chatId);
    const inputEl = document.getElementById('cht-input-' + chatId);
    if (!titleEl || !inputEl) return;
    titleEl.style.display = '';
    inputEl.style.display = 'none';
  }

  function deleteChat(chatId, event) {
    event.stopPropagation();
    showDCM().then(confirmed => {
      if (!confirmed) return;
      delete chatSessions[chatId];
      saveChatSessions();
      displayChatHistory();
      if (currentChatId === chatId) createNewChat();
    });
  }

function displayChatHistory() {
  const list = document.getElementById('chat-history-list');
  const chatIds = Object.keys(chatSessions).filter(id => !chatSessions[id]._empty).sort((a, b) => {
    const pa = chatSessions[a].pinned ? 1 : 0, pb = chatSessions[b].pinned ? 1 : 0;
    if (pb !== pa) return pb - pa;
    return chatSessions[b].timestamp - chatSessions[a].timestamp;
  });
  
  if (chatIds.length === 0) {
    list.innerHTML = `
      <div class="chat-history-empty">
        <div class="chunks-empty-icon"><svg class="icon" width="18" height="18"><use href="#icon-chat"/></svg></div>
        <div class="chunks-empty-text">No chats yet<br>Start a new conversation!</div>
      </div>
    `;
    return;
  }
  
  list.innerHTML = chatIds.map(chatId => {
    const session = chatSessions[chatId];
    
    let preview = 'Empty chat';
    if (session.messages.length > 0) {
      const firstMsg = session.messages[0];
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = firstMsg.html;
      const text = tempDiv.textContent || tempDiv.innerText;
      preview = text.substring(0, 50) + (text.length > 50 ? '...' : '');
    }
    
    const time = formatTimestamp(session.timestamp);
    const isActive = chatId === currentChatId ? 'active' : '';
    const isPinned = session.pinned ? 'pinned' : '';
    
    return `
      <div class="chat-history-item ${isActive} ${isPinned}" id="chi-${chatId}" onclick="loadChat('${chatId}')">
        <span class="chat-pin-indicator"><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="m16 12 2-2V4h1a1 1 0 0 0 0-2H5a1 1 0 0 0 0 2h1v6l-2 2v2h5v7l1 1 1-1v-7h5z"/></svg></span>
        <span class="chat-history-title" id="cht-title-${chatId}">${escapeHtml(session.title)}</span>
        <input class="chat-rename-input" id="cht-input-${chatId}" style="display:none;" value="${escapeHtml(session.title)}"
          onblur="finishChatRename('${chatId}')"
          onkeydown="if(event.key==='Enter'){event.preventDefault();finishChatRename('${chatId}')}if(event.key==='Escape')cancelChatRename('${chatId}')">
        <button class="chat-dots-btn" onclick="event.stopPropagation();showChatCtxMenu(event,'${chatId}')" title="More options">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
        </button>
      </div>
    `;
  }).join('');
}

  // ── Chat 3-dot context menu ──
  let _ctxMenuEl = null;
  function closeCtxMenu() { if (_ctxMenuEl) { _ctxMenuEl.remove(); _ctxMenuEl = null; } }
  document.addEventListener('click', closeCtxMenu);

  function showChatCtxMenu(e, chatId) {
    e.stopPropagation(); closeCtxMenu();
    const session = chatSessions[chatId];
    if (!session) return;
    const isPinned = !!session.pinned;
    const menu = document.createElement('div');
    menu.className = 'chat-ctx-menu';
    menu.onclick = e2 => e2.stopPropagation();
    menu.innerHTML = `<button class="chat-ctx-item" onclick="closeCtxMenu();startChatRename('${chatId}')">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg> Rename</button>
      <button class="chat-ctx-item" onclick="closeCtxMenu();pinChat('${chatId}')">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="${isPinned?'#fbbf24':'none'}" stroke="${isPinned?'#fbbf24':'currentColor'}" stroke-width="2"><path d="m16 12 2-2V4h1a1 1 0 0 0 0-2H5a1 1 0 0 0 0 2h1v6l-2 2v2h5v7l1 1 1-1v-7h5z"/></svg> ${isPinned?'Unpin':'Pin'}</button>
      <div class="chat-ctx-divider"></div>
      <button class="chat-ctx-item danger" onclick="closeCtxMenu();deleteChatDirect('${chatId}')">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg> Delete</button>`;
    document.body.appendChild(menu); _ctxMenuEl = menu;
    const rect = e.currentTarget.getBoundingClientRect();
    let top = rect.bottom + 4, left = rect.left - 120;
    if (left < 8) left = 8;
    if (top + 130 > window.innerHeight) top = rect.top - 130;
    menu.style.cssText = `position:fixed;top:${top}px;left:${left}px;z-index:99999`;
  }
  function pinChat(chatId) {
    if (!chatSessions[chatId]) return;
    chatSessions[chatId].pinned = !chatSessions[chatId].pinned;
    saveChatSessions(); displayChatHistory();
  }
  function deleteChatDirect(chatId) {
    showDCM().then(confirmed => {
      if (!confirmed) return;
      delete chatSessions[chatId]; saveChatSessions(); displayChatHistory();
      if (currentChatId === chatId) createNewChat();
    });
  }

  function formatTimestamp(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    const date = new Date(timestamp);
    return date.toLocaleDateString();
  }

  function saveChatSessions() {
    localStorage.setItem('eightysix_chat_sessions', JSON.stringify(chatSessions));
    // FIX 4: Also sync to Supabase for cross-device history
    _syncChatSessionsToCloud();
  }

  async function _syncChatSessionsToCloud() {
    if (!currentUser || !currentUser.email || isGuestMode) return;
    // Only sync sessions that have at least one real message
    const sessionsToSync = Object.fromEntries(
      Object.entries(chatSessions).filter(([, s]) =>
        s.messages && s.messages.some(m => m.sender === 'user')
      )
    );
    if (Object.keys(sessionsToSync).length === 0) return;
    try {
      const sb = await getSupabase();
      const { error } = await sb.from('chat_sessions').upsert({
        user_email: currentUser.email,
        sessions_json: JSON.stringify(sessionsToSync),
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_email' });
      if (error) {
        // Table missing — run SUPABASE_SETUP.sql
        if (error.code === '42P01' || error.message?.includes('does not exist') || error.code === 'PGRST116') return;
        console.warn('[Chunks] Chat sync error:', error.code, error.message);
      }
    } catch(e) {
      console.warn('[Chunks] Chat sync failed:', e.message);
    }
  }

  async function _loadChatSessionsFromCloud() {
    if (!currentUser || !currentUser.email || isGuestMode) return false;
    try {
      const sb = await getSupabase();
      const { data, error } = await sb
        .from('chat_sessions')
        .select('sessions_json, updated_at')
        .eq('user_email', currentUser.email)
        .single();
      // Table doesn't exist yet — skip silently
      if (error) return false;
      if (!data) return false;
      const cloudSessions = JSON.parse(data.sessions_json || '{}');
      const localKeys = Object.keys(chatSessions).length;
      const cloudKeys = Object.keys(cloudSessions).length;
      // Smart merge: take the union of local + cloud, newest wins per chatId
      let merged = { ...chatSessions };
      let didUpdate = false;
      for (const [id, session] of Object.entries(cloudSessions)) {
        const local = chatSessions[id];
        if (!local || (session.timestamp || 0) > (local.timestamp || 0)) {
          merged[id] = session;
          didUpdate = true;
        }
      }
      if (didUpdate || cloudKeys > localKeys) {
        chatSessions = merged;
        localStorage.setItem('eightysix_chat_sessions', JSON.stringify(chatSessions));
        displayChatHistory();
        return true;
      }
    } catch(e) {
      console.warn('[Chunks] Cloud chat load failed:', e.message);
    }
    return false;
  }

  function loadChatSessions() {
    // Load from localStorage immediately (fast, synchronous)
    const saved = localStorage.getItem('eightysix_chat_sessions');
    if (saved) {
      try {
        chatSessions = JSON.parse(saved);
      } catch (e) {
        chatSessions = {};
      }
    }
    // NOTE: Cloud sync is triggered after auth completes (in onAuthReady)
    // NOT here — because currentUser isn't set yet at this point.
  }

  // Called once after auth is confirmed — pulls cloud chats and merges
  async function onAuthReadySyncChats() {
    if (!currentUser || !currentUser.email || isGuestMode) return;
    const didSync = await _loadChatSessionsFromCloud();
    if (didSync) {
      displayChatHistory();
    }
    // Also push local sessions to cloud in case this is a new device
    _syncChatSessionsToCloud();
  }

  setInterval(() => {
    if (currentChatId) {
      saveCurrentChat();
    }
  }, 30000);


  // ── AI Learning Loop: analyse weak topics and recommend what to study next ──
  async function getAIStudyRecommendation(topic, accuracy, incorrectCards) {
    if (!incorrectCards || incorrectCards.length === 0) return null;
    try {
      const progress = getProgressData();
      const allTopics = Object.entries(progress.topics || {})
        .map(([t, d]) => ({ topic: t, accuracy: d.averageAccuracy || 0, sessions: d.sessions?.length || 0 }))
        .sort((a, b) => a.accuracy - b.accuracy);
      
      const weakTopics = allTopics.filter(t => t.accuracy < 70).slice(0, 3);
      const missedConcepts = incorrectCards.slice(0, 5).map(c => c.front).join(', ');
      
      const prompt = `A student just completed flashcards on "${topic}" with ${accuracy}% accuracy.
Concepts they struggled with: ${missedConcepts}
Their overall weak topics (sorted by accuracy): ${weakTopics.map(t => `${t.topic} (${t.accuracy}%)`).join(', ') || 'none yet'}

Give a SHORT, encouraging study recommendation (2-3 sentences max). Be specific about what to review next. Use plain text, no markdown.`;

      const _apiUrl = window.API_URL || window.__API_URL__ || 'https://chunksai.up.railway.app';
      const res = await fetch(`${_apiUrl}/ask`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(window._authToken ? { 'Authorization': 'Bearer ' + window._authToken } : {})
        },
        body: JSON.stringify({
          question: prompt,
          mode: 'study',
          complexity: 3,
          bookId: window._currentBookId || 'zumdahl',
          history: []
        })
      });
      if (!res.ok) return null;
      // /ask returns plain JSON — just read it directly
      const data = await res.json();
      return (data.answer || data.reply || data.message || '').trim() || null;
    } catch(e) {
      return null;
    }
  }

  async function showAIRecommendation(topic, accuracy, incorrectCards, containerEl) {
    if (accuracy >= 90 || !incorrectCards?.length) return; // Perfect score — no need
    const recDiv = document.createElement('div');
    recDiv.style.cssText = 'margin-top:20px;padding:16px;background:rgba(102,126,234,0.08);border:1px solid rgba(102,126,234,0.2);border-radius:10px;text-align:left;';
    recDiv.innerHTML = `<div style="font-size:12px;color:#a78bfa;font-weight:600;margin-bottom:8px;display:flex;align-items:center;gap:6px;">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 4v8"/><circle cx="12" cy="18" r="1"/></svg>
      AI Study Coach
    </div>
    <div id="ai-rec-text" style="font-size:13px;color:rgba(255,255,255,0.75);line-height:1.6;">
      <span style="opacity:0.5">Analysing your results...</span>
    </div>`;
    containerEl.appendChild(recDiv);
    const recommendation = await getAIStudyRecommendation(topic, accuracy, incorrectCards);
    const textEl = recDiv.querySelector('#ai-rec-text');
    if (recommendation && textEl) {
      textEl.textContent = recommendation;
    } else if (textEl) {
      recDiv.remove();
    }
  }

// 3D MOLECULE VIEWER
let modalViewer = null;
let currentModalStyle = 'stick';
let activeBubbles = [];

function createMoleculeBubble(moleculeName, index = 0) {
    const container = document.getElementById('molecule-bubbles-container');
    
    if (document.querySelector(`[data-molecule="${moleculeName}"]`)) {
        return;
    }
    
    const bubble = document.createElement('div');
    bubble.className = 'molecule-bubble';
    bubble.setAttribute('data-molecule', moleculeName);
    
    const positions = [
        { right: '30px', top: '20%' },
        { right: '30px', top: '40%' },
        { right: '30px', top: '60%' },
    ];
    
    const pos = positions[index % positions.length];
    const molData = getMoleculeData(moleculeName);
    
    bubble.style.cssText = `right:${pos.right};top:${pos.top};${molData.cssVars}`;
    bubble.innerHTML = `
        <div class="molecule-bubble-icon">
            ${molData.svg}
        </div>
        <div class="molecule-bubble-name">${moleculeName.charAt(0).toUpperCase()+moleculeName.slice(1)}</div>
        ${molData.formula ? `<div class="molecule-bubble-formula">${molData.formula}</div>` : ''}
    `;
    
    makeBubbleDraggable(bubble);
    
    bubble.addEventListener('click', (e) => {
        if (!bubble.classList.contains('dragging')) {
            openMoleculeModal(moleculeName);
        }
    });
    
    container.appendChild(bubble);
    activeBubbles.push(bubble);
    
    setTimeout(() => {
        bubble.style.opacity = '1';
    }, 100);
    
    setTimeout(() => {
        removeMoleculeBubble(bubble);
    }, 30000);
}

function makeBubbleDraggable(bubble) {
    let isDragging = false;
    let startX, startY, initialX, initialY;
    
    bubble.addEventListener('mousedown', startDrag);
    bubble.addEventListener('touchstart', startDrag);
    
    function startDrag(e) {
        isDragging = true;
        bubble.classList.add('dragging');
        
        const touch = e.type === 'touchstart' ? e.touches[0] : e;
        startX = touch.clientX;
        startY = touch.clientY;
        
        const rect = bubble.getBoundingClientRect();
        initialX = rect.left;
        initialY = rect.top;
        
        document.addEventListener('mousemove', drag);
        document.addEventListener('touchmove', drag);
        document.addEventListener('mouseup', stopDrag);
        document.addEventListener('touchend', stopDrag);
    }
    
    function drag(e) {
        if (!isDragging) return;
        e.preventDefault();
        
        const touch = e.type === 'touchmove' ? e.touches[0] : e;
        const deltaX = touch.clientX - startX;
        const deltaY = touch.clientY - startY;
        
        bubble.style.left = (initialX + deltaX) + 'px';
        bubble.style.top = (initialY + deltaY) + 'px';
        bubble.style.right = 'auto';
    }
    
    function stopDrag() {
        setTimeout(() => {
            isDragging = false;
            bubble.classList.remove('dragging');
        }, 100);
        
        document.removeEventListener('mousemove', drag);
        document.removeEventListener('touchmove', drag);
        document.removeEventListener('mouseup', stopDrag);
        document.removeEventListener('touchend', stopDrag);
    }
}

function removeMoleculeBubble(bubble) {
    bubble.style.opacity = '0';
    bubble.style.transform = 'scale(0)';
    setTimeout(() => {
        bubble.remove();
        activeBubbles = activeBubbles.filter(b => b !== bubble);
    }, 300);
}

// Enhanced molecule viewer with lone pairs
let currentMoleculeData = null;
let showingLonePairs = false;
let showingLabels = false;

async function openMoleculeModal(moleculeName) {
    // Free tier: 3D molecule viewer is a Premium feature
    if (isFreeTier()) {
      showToast('🔒 3D Molecule Viewer is a Premium feature. Upgrade to unlock!');
      openPricingModal();
      return;
    }
    const modal = document.getElementById('molecule-modal');
    const nameElement = document.getElementById('modal-molecule-name');
    const formulaElement = document.getElementById('modal-molecule-formula');
    const viewerElement = document.getElementById('modal-molecule-viewer');
    
    modal.classList.add('active');
    _saveView('molecule', moleculeName);
    const displayName = moleculeName.charAt(0).toUpperCase() + moleculeName.slice(1);
    nameElement.innerHTML = displayName;
    formulaElement.innerHTML = '<span style="opacity:0.5;">Loading molecular data...</span>';

    // Load real molecule image from PubChem
    const imgEl = document.getElementById('modal-molecule-img');
    const fallbackEl = document.getElementById('modal-molecule-img-fallback');
    if (imgEl && fallbackEl) {
        imgEl.style.display = 'none';
        fallbackEl.style.display = 'inline';
        const pubchemImgUrl = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(moleculeName)}/PNG?image_size=200x200`;
        imgEl.onload = () => {
            imgEl.style.display = 'block';
            fallbackEl.style.display = 'none';
        };
        imgEl.onerror = () => {
            imgEl.style.display = 'none';
            fallbackEl.style.display = 'inline';
        };
        imgEl.src = pubchemImgUrl;
    }
    
    viewerElement.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; height: 100%; flex-direction: column; gap: 16px;">
            <div style="font-size: 64px; animation: spin 2s linear infinite;">⚛️</div>
            <div style="color: #667eea; font-size: 18px; font-weight: 600;">Loading Molecule...</div>
        </div>
    `;
    
    // FIX 2: Always recreate viewer to avoid stale canvas state
    if (modalViewer) {
      try { modalViewer.clear(); } catch(e) {}
      modalViewer = null;
    }
    viewerElement.innerHTML = '';
    
    if (typeof $3Dmol === 'undefined') {
        viewerElement.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;flex-direction:column;gap:12px;color:#aaa;padding:20px;text-align:center;">
            <img id="mol-fallback-img" src="https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(moleculeName)}/PNG?image_size=300x300" 
              style="max-width:280px;max-height:280px;border-radius:12px;background:#fff;padding:8px;" 
              onerror="this.parentElement.innerHTML='<div style=\\'font-size:48px;margin-bottom:12px;\\'>🧬</div><div>3D viewer unavailable</div>'">
            <div style="font-size:13px;opacity:0.6;margin-top:8px;">${moleculeName}</div>
        </div>`;
        return;
    }
    
    try {
        modalViewer = $3Dmol.createViewer(viewerElement, {
            backgroundColor: '#0f0f1e'
        });
    } catch(e) {
        console.error('3Dmol viewer creation failed:', e);
        viewerElement.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;"><img src="https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(moleculeName)}/PNG?image_size=300x300" style="max-width:280px;border-radius:8px;background:#fff;padding:8px;" onerror="this.style.display='none'"></div>`;
        return;
    }
    
    try {
        const response = await fetch(
            `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(moleculeName)}/SDF`
        );
        
        if (!response.ok) throw new Error('Molecule not found');
        
        const sdfData = await response.text();
        
        // DO NOT reset innerHTML here — viewer is already attached to viewerElement
        // Clearing innerHTML destroys the WebGL canvas and crashes $3Dmol
        modalViewer.addModel(sdfData, 'sdf');
        
        // Store molecule data for lone pairs
        currentMoleculeData = modalViewer.getModel();
        
        // Calculate and display molecular properties
        updateMolecularProperties(currentMoleculeData, moleculeName);
        
        // Apply default style (ball-stick)
        currentModalStyle = 'ball-stick';
        applyModalStyle('ball-stick');
        
        // Reset toggles
        const lonePairToggle = document.getElementById('show-lone-pairs');
        const labelsToggle = document.getElementById('show-labels');
        if (lonePairToggle) lonePairToggle.checked = false;
        if (labelsToggle) labelsToggle.checked = false;
        showingLonePairs = false;
        showingLabels = false;
        
        modalViewer.zoomTo();
        modalViewer.render();
        
    } catch (error) {
        console.error('Failed to load molecule:', error);
        viewerElement.innerHTML = `
            <div style="color: #ff4757; padding: 60px 40px; text-align: center;">
                <div style="font-size: 64px; margin-bottom: 24px;">❌</div>
                <div style="font-size: 20px; font-weight: 600; margin-bottom: 12px;">Could not load "${moleculeName}"</div>
                <div style="font-size: 14px; opacity: 0.7; line-height: 1.6;">
                    Try these molecules:<br>
                    water, ammonia, methane, ethanol, glucose, benzene
                </div>
            </div>
        `;
        formulaElement.textContent = 'Not available';
    }
}

function closeMoleculeModal() {
    const modal = document.getElementById('molecule-modal');
    modal.classList.remove('active');
    _clearView('molecule');
}

function applyModalStyle(style) {
    if (!modalViewer) return;
    
    // Remove active class from all style buttons
    document.querySelectorAll('.style-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Add active class to selected button
    const activeBtn = document.getElementById(`style-${style}`);
    if (activeBtn) {
        activeBtn.classList.add('active');
    }
    
    modalViewer.setStyle({}, {});
    
    switch(style) {
        case 'stick':
            modalViewer.setStyle({}, {stick: {radius: 0.15, colorscheme: 'Jmol'}});
            break;
        case 'sphere':
            modalViewer.setStyle({}, {sphere: {scale: 0.35, colorscheme: 'Jmol'}});
            break;
        case 'ball-stick':
            modalViewer.setStyle({}, {
                stick: {radius: 0.15, colorscheme: 'Jmol'}, 
                sphere: {scale: 0.25, colorscheme: 'Jmol'}
            });
            break;
    }
    
    currentModalStyle = style;
    
    // Reapply lone pairs if they were showing
    if (showingLonePairs) {
        addLonePairs();
    }
    
    modalViewer.render();
}

function toggleLonePairs(show) {
    if (!modalViewer || !currentMoleculeData) return;
    
    showingLonePairs = show;
    
    if (show) {
        addLonePairs();
    } else {
        // Remove lone pairs by re-rendering without them
        applyModalStyle(currentModalStyle);
    }
}

function addLonePairs() {
    if (!modalViewer || !currentMoleculeData) return;
    
    const atoms = currentMoleculeData.selectedAtoms({});
    
    // Add lone pairs for oxygen and nitrogen atoms
    atoms.forEach(atom => {
        const element = atom.elem;
        const pos = atom;
        
        // Oxygen typically has 2 lone pairs (4 dots total)
        if (element === 'O') {
            addLonePairLobes(pos, 2, 0.5); // 2 pairs
        }
        // Nitrogen typically has 1 lone pair (2 dots total)
        else if (element === 'N') {
            addLonePairLobes(pos, 1, 0.6); // 1 pair
        }
    });
    
    modalViewer.render();
}

function addLonePairLobes(atomPos, pairCount, distance) {
    // Add TWO small spheres per lone pair to represent electron pair
    
    const lonePairColor = '#FFD700'; // Golden color
    const dotSize = 0.12; // Smaller dots
    const dotSeparation = 0.15; // Distance between the 2 dots in a pair
    
    for (let i = 0; i < pairCount; i++) {
        // Calculate position for this lone pair around the atom
        const angle = (i * 2 * Math.PI) / pairCount + Math.PI / 4;
        
        // Base position for the lone pair
        const baseX = atomPos.x + distance * Math.cos(angle);
        const baseY = atomPos.y + distance * Math.sin(angle);
        const baseZ = atomPos.z + distance * 0.3;
        
        // Create TWO dots for each lone pair (electron pair = 2 electrons)
        // Dot 1 (slightly to the left)
        modalViewer.addSphere({
            center: {
                x: baseX - dotSeparation * Math.sin(angle) * 0.5,
                y: baseY + dotSeparation * Math.cos(angle) * 0.5,
                z: baseZ
            },
            radius: dotSize,
            color: lonePairColor,
            alpha: 0.8
        });
        
        // Dot 2 (slightly to the right)
        modalViewer.addSphere({
            center: {
                x: baseX + dotSeparation * Math.sin(angle) * 0.5,
                y: baseY - dotSeparation * Math.cos(angle) * 0.5,
                z: baseZ
            },
            radius: dotSize,
            color: lonePairColor,
            alpha: 0.8
        });
    }
}

function toggleLabels(show) {
    if (!modalViewer) return;
    
    showingLabels = show;
    
    if (show) {
        const atoms = modalViewer.getModel().selectedAtoms({});
        atoms.forEach((atom, index) => {
            modalViewer.addLabel(atom.elem + (index + 1), {
                position: atom,
                fontSize: 12,
                fontColor: 'white',
                backgroundColor: 'rgba(0,0,0,0.7)',
                backgroundOpacity: 0.7
            });
        });
    } else {
        modalViewer.removeAllLabels();
    }
    
    modalViewer.render();
}

function updateMolecularProperties(model, moleculeName) {
    try {
        const atoms = model.selectedAtoms({});
        
        // Count atoms by element
        const elementCounts = {};
        atoms.forEach(atom => {
            const elem = atom.elem;
            elementCounts[elem] = (elementCounts[elem] || 0) + 1;
        });
        
        // Build formula string
        let formula = '';
        const elementOrder = ['C', 'H', 'O', 'N', 'S', 'P', 'Cl', 'Br', 'F', 'I'];
        elementOrder.forEach(elem => {
            if (elementCounts[elem]) {
                formula += elem;
                if (elementCounts[elem] > 1) {
                    formula += elementCounts[elem];
                }
            }
        });
        
        // Add remaining elements
        Object.keys(elementCounts).forEach(elem => {
            if (!elementOrder.includes(elem)) {
                formula += elem;
                if (elementCounts[elem] > 1) {
                    formula += elementCounts[elem];
                }
            }
        });
        
        // Calculate molecular weight (simplified)
        const atomicWeights = {
            'H': 1.008, 'C': 12.011, 'N': 14.007, 'O': 15.999,
            'S': 32.06, 'P': 30.974, 'Cl': 35.45, 'Br': 79.904,
            'F': 18.998, 'I': 126.90
        };
        
        let molecularWeight = 0;
        Object.keys(elementCounts).forEach(elem => {
            if (atomicWeights[elem]) {
                molecularWeight += atomicWeights[elem] * elementCounts[elem];
            }
        });
        
        // Count bonds
        let bondCount = 0;
        try {
            const bonds = model.selectedBonds({});
            bondCount = bonds ? bonds.length : 0;
        } catch (e) {
        }
        
        // Update DOM
        const formulaElem = document.getElementById('modal-molecule-formula');
        const propFormula = document.getElementById('prop-formula');
        const propWeight = document.getElementById('prop-weight');
        const propAtoms = document.getElementById('prop-atoms');
        const propBonds = document.getElementById('prop-bonds');
        
        if (formulaElem) formulaElem.innerHTML = formatChemFormula(formula || 'Unknown');
        if (propFormula) propFormula.innerHTML = formatChemFormula(formula || '-');
        if (propWeight) propWeight.textContent = molecularWeight > 0 ? molecularWeight.toFixed(2) + ' g/mol' : '-';
        if (propAtoms) propAtoms.textContent = atoms.length || '-';
        if (propBonds) propBonds.textContent = bondCount || '-';
        
    } catch (error) {
        console.error('Error calculating properties:', error);
    }
}

function formatChemFormula(formula) {
  if (!formula) return '';
  return formula.replace(/(\d+)/g, '<sub>$1</sub>');
}

function resetModalView() {
    if (!modalViewer) return;
    modalViewer.zoomTo();
    modalViewer.rotate(0, {x:0, y:1, z:0});
    modalViewer.render();
}


function downloadModalMolecule() {
    const nameEl = document.getElementById('modal-molecule-name');
    const moleculeName = (nameEl.textContent || nameEl.innerText).replace(/[^\w\s]/g, '').trim();
    const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(moleculeName)}/SDF`;
    window.open(url, '_blank');
}

// COMPLEXITY SLIDER
let currentComplexity = 5;

function updateComplexityCompact(value) {
  currentComplexity = parseInt(value);
  document.getElementById('complexity-value-compact').textContent = value;
  const labels = {
    1: '· Age 10', 2: '· Beginner', 3: '· Middle School',
    4: '· High School', 5: '· Intro Uni', 6: '· Uni Year 1',
    7: '· Uni Year 3', 8: '· Advanced', 9: '· Graduate', 10: '· Expert'
  };
  const labelEl = document.getElementById('complexity-label-compact');
  if (labelEl) labelEl.textContent = labels[currentComplexity] || '';
  localStorage.setItem('eightysix_complexity', currentComplexity);
}

window.addEventListener('load', () => {
  const savedComplexity = localStorage.getItem('eightysix_complexity');
  if (savedComplexity) {
    const slider = document.getElementById('complexity-slider-compact');
    if (slider) {
      slider.value = savedComplexity;
      updateComplexityCompact(savedComplexity);
    }
  }
  
  // Start study session if not already started (only if tab is visible)
  const progress = getProgressData();
  if (!document.hidden) {
    if (!progress.sessionStartTime) {
      startStudySession();
    } else {
    }
  } else {
  }
});

// ==========================================
// ACTIVE TIME TRACKING (Only when tab is visible)
// ==========================================

let isTabActive = !document.hidden;
let lastActiveTime = Date.now();

// Track when tab visibility changes
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // Tab became inactive (user switched tabs or minimized window)
    isTabActive = false;
    
    // Save the time accumulated while tab was active
    updateStudyTime();
  } else {
    // Tab became active again
    isTabActive = true;
    lastActiveTime = Date.now();
    
    // Restart session timer
    const progress = getProgressData();
    progress.sessionStartTime = Date.now();
    saveProgressData(progress);
  }
});

// Update study time every 1 minute (only if tab is active)
setInterval(() => {
  if (isTabActive && !document.hidden) {
    updateStudyTime();
  } else {
  }
}, 60000); // 1 minute

async function handlePPTUpload(event) {
  if (isFreeTier()) {
    showToast('🔒 File upload is a Premium feature. Upgrade to unlock!');
    openPricingModal();
    event.target.value = '';
    return;
  }
  const file = event.target.files[0];
  
  if (!file) return;
  
  // Show loading
  showLoadingModal('Processing PowerPoint...', 'This may take 30-60 seconds');
  
  try {
    // Upload and extract
    const formData = new FormData();
    formData.append('file', file);
    
    const response = await fetch(`${window.API_URL}/upload-document`, {
      method: 'POST',
      body: formData
    });
    
    const data = await response.json();
    
    if (data.success) {
      
      // Store slides data
      window.currentSlides = data.slides;
      window._currentUploadFilename = file.name;
      
      // Hide loading, show options
      hideLoadingModal();
      showMaterialGeneratorModal(data);
      
    } else {
      throw new Error(data.error);
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
    hideLoadingModal();
    _showToast('❌ Error processing PowerPoint: ' + error.message);
  }
}

function showMaterialGeneratorModal(data) {
  const modal = document.createElement('div');
  modal.id = 'material-generator-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0,0,0,0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;
  
  modal.innerHTML = `
    <div style="
      background: #141420;
      border: 1px solid rgba(255,255,255,0.08);
      padding: 28px 24px 24px;
      border-radius: 20px;
      max-width: 480px;
      width: 92%;
      max-height: 90vh;
      overflow-y: auto;
      box-shadow: 0 32px 80px rgba(0,0,0,0.7);
    ">
      <!-- Header -->
      <div style="display:flex; align-items:center; gap:12px; margin-bottom:6px;">
        <div style="width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,#667eea,#764ba2);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M14 3h7v7"/><path d="M14 10 21 3"/></svg>
        </div>
        <div>
          <div style="color:white;font-size:18px;font-weight:700;line-height:1.2;">Generate Study Materials</div>
          <div style="color:rgba(255,255,255,0.35);font-size:12px;margin-top:2px;">From: ${data.filename} (${data.total_slides} slides)</div>
        </div>
      </div>

      <div style="height:1px;background:rgba(255,255,255,0.07);margin:18px 0;"></div>

      <div style="display:grid;gap:10px;">
        <button onclick="generateMaterial('notes')" class="material-btn">
          <div class="mat-icon" style="background:rgba(99,179,237,0.15);">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#63b3ed" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/><line x1="10" x2="8" y1="9" y2="9"/></svg>
          </div>
          <div class="mat-text">
            <span class="mat-title">Study Notes</span>
            <span class="mat-desc">Comprehensive notes with key concepts</span>
          </div>
          <svg class="mat-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
        </button>

        <button onclick="generateMaterial('reviewer')" class="material-btn">
          <div class="mat-icon" style="background:rgba(252,129,74,0.15);">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fc814a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
          </div>
          <div class="mat-text">
            <span class="mat-title">Exam Reviewer</span>
            <span class="mat-desc">Must-know concepts + practice problems</span>
          </div>
          <svg class="mat-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
        </button>

        <button onclick="generateMaterial('flashcards')" class="material-btn">
          <div class="mat-icon" style="background:rgba(154,117,234,0.15);">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9a75ea" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>
          </div>
          <div class="mat-text">
            <span class="mat-title">Flashcards</span>
            <span class="mat-desc">15–20 cards for memorization</span>
          </div>
          <svg class="mat-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
        </button>

        <button onclick="generateMaterial('summary')" class="material-btn">
          <div class="mat-icon" style="background:rgba(72,187,120,0.15);">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#48bb78" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg>
          </div>
          <div class="mat-text">
            <span class="mat-title">Summary Sheet</span>
            <span class="mat-desc">One-page cheat sheet</span>
          </div>
          <svg class="mat-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
        </button>

        <button onclick="generateMaterial('quiz')" class="material-btn">
          <div class="mat-icon" style="background:rgba(237,137,54,0.15);">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ed8936" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>
          </div>
          <div class="mat-text">
            <span class="mat-title">Practice Quiz</span>
            <span class="mat-desc" id="quiz-btn-desc">10 multiple choice questions</span>
          </div>
          <svg class="mat-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
        </button>

        <div style="height:1px;background:rgba(255,255,255,0.06);margin:4px 0;"></div>

        <button onclick="generateMaterial('all')" class="material-btn mat-btn-everything">
          <div class="mat-icon" style="background:rgba(102,126,234,0.25);">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>
          </div>
          <div class="mat-text">
            <span class="mat-title" style="color:#c4b5fd;">Generate Everything</span>
            <span class="mat-desc">All study materials at once</span>
          </div>
          <svg class="mat-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
        </button>
      </div>

      <button onclick="closeMaterialGenerator()" style="
        width:100%; margin-top:14px; padding:13px;
        background:transparent; border:1px solid rgba(255,255,255,0.08);
        border-radius:12px; color:rgba(255,255,255,0.4); cursor:pointer;
        font-size:14px; transition:all 0.2s;
      " onmouseover="this.style.background='rgba(255,255,255,0.05)';this.style.color='rgba(255,255,255,0.7)'"
         onmouseout="this.style.background='transparent';this.style.color='rgba(255,255,255,0.4)'">
        Cancel
      </button>
    </div>
  `;
  
  document.body.appendChild(modal);
}

async function generateMaterial(type) {
  if (isFreeTier()) {
    showToast('🔒 Study material generation is a Premium feature. Upgrade to unlock!');
    openPricingModal();
    return;
  }
  
  // Quiz type gets its own flow with difficulty picker
  if (type === 'quiz') {
    showQuizDifficultyPicker();
    return;
  }

  closeMaterialGenerator();
  showLoadingModal(`Generating ${type}...`, 'AI is creating your study materials');
  
  try {
    const response = await fetch(`${window.API_URL}/generate-study-materials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slides: window.currentSlides,
        type: type
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      hideLoadingModal();
      saveMaterialToLibrary(data.materials, type, window._currentUploadFilename || 'Uploaded File');
      displayGeneratedMaterials(data.materials, type);
    } else {
      throw new Error(data.error);
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
    hideLoadingModal();
    _showToast('❌ Error generating materials: ' + error.message);
  }
}

// Show a small difficulty + count picker before generating quiz
function showQuizDifficultyPicker() {
  const existing = document.getElementById('quiz-difficulty-picker');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'quiz-difficulty-picker';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:11000;backdrop-filter:blur(4px);';
  modal.innerHTML = `
    <div style="background:#1e293b;border-radius:16px;padding:28px;width:92%;max-width:420px;border:1px solid rgba(255,255,255,0.1);box-shadow:0 24px 60px rgba(0,0,0,0.6);">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;">
        <div style="width:38px;height:38px;border-radius:10px;background:linear-gradient(135deg,#ed8936,#f59e0b);display:flex;align-items:center;justify-content:center;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>
        </div>
        <div>
          <div style="color:white;font-size:16px;font-weight:700;">Generate Quiz</div>
          <div style="color:rgba(255,255,255,0.4);font-size:12px;">Choose difficulty and number of questions</div>
        </div>
      </div>

      <!-- Difficulty -->
      <div style="margin-bottom:16px;">
        <div style="color:rgba(255,255,255,0.6);font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:8px;">Difficulty</div>
        <div style="display:flex;gap:8px;">
          ${[
            {id:'easy',  label:'Easy',   color:'#4ade80', desc:'Direct recall'},
            {id:'medium',label:'Medium', color:'#fbbf24', desc:'Conceptual'},
            {id:'hard',  label:'Hard',   color:'#f87171', desc:'Analysis'},
          ].map(d => `
            <button id="diff-${d.id}" onclick="selectQuizDifficulty('${d.id}')"
              style="flex:1;padding:10px 6px;border-radius:10px;border:2px solid ${d.id==='medium'?d.color:'rgba(255,255,255,0.1)'};
              background:${d.id==='medium'?`${d.color}22`:'rgba(255,255,255,0.04)'};cursor:pointer;transition:all 0.18s;text-align:center;"
              data-color="${d.color}">
              <div style="font-size:13px;font-weight:700;color:${d.id==='medium'?d.color:'rgba(255,255,255,0.7)'};">${d.label}</div>
              <div style="font-size:10px;color:rgba(255,255,255,0.4);margin-top:2px;">${d.desc}</div>
            </button>
          `).join('')}
        </div>
      </div>

      <!-- Question count -->
      <div style="margin-bottom:20px;">
        <div style="color:rgba(255,255,255,0.6);font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:8px;">Number of Questions</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${[5,10,15,20,30,50].map(n => `
            <button id="qcount-${n}" onclick="selectQuizCount(${n})"
              style="flex:1;min-width:50px;padding:9px;border-radius:8px;border:2px solid ${n===10?'#667eea':'rgba(255,255,255,0.1)'};
              background:${n===10?'rgba(102,126,234,0.2)':'rgba(255,255,255,0.04)'};
              cursor:pointer;font-size:14px;font-weight:700;color:${n===10?'#a5b4fc':'rgba(255,255,255,0.6)'};transition:all 0.18s;">
              ${n}
            </button>
          `).join('')}
        </div>
      </div>

      <!-- Quiz Mode -->
      <div style="margin-bottom:20px;">
        <div style="color:rgba(255,255,255,0.6);font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:8px;">Quiz Mode</div>
        <div style="display:flex;gap:8px;">
          <button id="qmode-standard" onclick="selectQuizMode('standard')"
            style="flex:1;padding:10px 8px;border-radius:10px;border:2px solid rgba(102,126,234,0.8);background:rgba(102,126,234,0.18);cursor:pointer;text-align:center;transition:all 0.18s;">
            <div style="font-size:13px;font-weight:700;color:#a5b4fc;">Standard</div>
            <div style="font-size:10px;color:rgba(255,255,255,0.4);margin-top:2px;">Direct concept questions</div>
          </button>
          <button id="qmode-situational" onclick="selectQuizMode('situational')"
            style="flex:1;padding:10px 8px;border-radius:10px;border:2px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);cursor:pointer;text-align:center;transition:all 0.18s;">
            <div style="font-size:13px;font-weight:700;color:rgba(255,255,255,0.7);">🎭 Situational</div>
            <div style="font-size:10px;color:rgba(255,255,255,0.4);margin-top:2px;">Real-world scenario-based</div>
          </button>
        </div>
      </div>

      <!-- Actions -->
      <div style="display:flex;gap:10px;">
        <button onclick="document.getElementById('quiz-difficulty-picker').remove()" style="flex:1;padding:12px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:rgba(255,255,255,0.5);cursor:pointer;font-size:14px;">Cancel</button>
        <button onclick="startMaterialQuiz()" style="flex:2;padding:12px;background:linear-gradient(135deg,#667eea,#764ba2);border:none;border-radius:10px;color:white;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 4px 14px rgba(102,126,234,0.35);">
          Generate Quiz ✨
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  if (!window._quizDifficulty) window._quizDifficulty = 'medium';
  if (!window._quizCount)      window._quizCount      = 10;
  if (!window._quizMode)       window._quizMode       = 'standard';
  selectQuizDifficulty(window._quizDifficulty);
  selectQuizCount(window._quizCount);
  selectQuizMode(window._quizMode);
}






function selectQuizMode(mode) {
  window._quizMode = mode;
  const stdBtn = document.getElementById('qmode-standard');
  const sitBtn = document.getElementById('qmode-situational');
  if (!stdBtn || !sitBtn) return;
  if (mode === 'standard') {
    stdBtn.style.borderColor = 'rgba(102,126,234,0.8)';
    stdBtn.style.background  = 'rgba(102,126,234,0.18)';
    stdBtn.querySelector('div').style.color = '#a5b4fc';
    sitBtn.style.borderColor = 'rgba(255,255,255,0.1)';
    sitBtn.style.background  = 'rgba(255,255,255,0.04)';
    sitBtn.querySelector('div').style.color = 'rgba(255,255,255,0.7)';
  } else {
    sitBtn.style.borderColor = 'rgba(251,146,60,0.8)';
    sitBtn.style.background  = 'rgba(251,146,60,0.18)';
    sitBtn.querySelector('div').style.color = '#fdba74';
    stdBtn.style.borderColor = 'rgba(255,255,255,0.1)';
    stdBtn.style.background  = 'rgba(255,255,255,0.04)';
    stdBtn.querySelector('div').style.color = 'rgba(255,255,255,0.7)';
  }
}

function selectQuizDifficulty(level) {
  window._quizDifficulty = level;
  const colors = { easy: '#4ade80', medium: '#fbbf24', hard: '#f87171' };
  ['easy','medium','hard'].forEach(d => {
    const btn = document.getElementById(`diff-${d}`);
    if (!btn) return;
    const col = colors[d];
    const active = d === level;
    btn.style.borderColor = active ? col : 'rgba(255,255,255,0.1)';
    btn.style.background  = active ? `${col}22` : 'rgba(255,255,255,0.04)';
    btn.querySelector('div').style.color = active ? col : 'rgba(255,255,255,0.7)';
  });
}

function selectQuizCount(n) {
  window._quizCount = n;
  [5,10,15,20,30,50].forEach(c => {
    const btn = document.getElementById(`qcount-${c}`);
    if (!btn) return;
    const active = c === n;
    btn.style.borderColor = active ? '#667eea' : 'rgba(255,255,255,0.1)';
    btn.style.background  = active ? 'rgba(102,126,234,0.2)' : 'rgba(255,255,255,0.04)';
    btn.style.color       = active ? '#a5b4fc' : 'rgba(255,255,255,0.6)';
  });
  const descEl = document.getElementById('quiz-btn-desc');
  if (descEl) descEl.textContent = n + ' multiple choice questions';
}

// ── Fetch one batch of questions from the server ────────────────────────────
async function _fetchQuizBatch(slides, count, difficulty, quizMode, usedQuestions) {
  const res = await fetch(`${window.API_URL}/generate-quiz`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slides, count, difficulty, mode: quizMode, existingQuestions: usedQuestions })
  });
  const data = await res.json();
  if (!data.success || !data.questions || data.questions.length === 0)
    throw new Error(data.error || 'No questions returned');
  return data.questions;
}

// ── Fetch ALL requested questions in batches of 20 ──────────────────────────
async function _fetchAllQuizQuestions(slides, totalCount, difficulty, quizMode, usedQuestions, onProgress) {
  const BATCH = 20;
  let allNew = [];
  let used   = usedQuestions.slice();
  let remaining = totalCount;

  while (remaining > 0) {
    const batchSize = Math.min(BATCH, remaining);
    onProgress && onProgress(allNew.length, totalCount);
    const batch = await _fetchQuizBatch(slides, batchSize, difficulty, quizMode, used);
    batch.forEach(q => {
      const t = (q.question || '').substring(0, 80);
      if (t && !used.includes(t)) used.push(t);
    });
    allNew = allNew.concat(batch);
    remaining -= batchSize;
    // If batch returned fewer than asked, stop (model ran out of unique questions)
    if (batch.length < batchSize) break;
  }
  return allNew;
}

// ── Start a brand-new quiz (replaces the player) ─────────────────────────────
async function startMaterialQuiz(slidesOverride, containerOverride) {
  const picker = document.getElementById('quiz-difficulty-picker');
  if (picker) picker.remove();
  if (typeof closeMaterialGenerator === 'function') closeMaterialGenerator();

  const difficulty = window._quizDifficulty || 'medium';
  const count      = window._quizCount || 10;
  const quizMode   = window._quizMode || 'standard';
  const slides     = slidesOverride || window.currentSlides;

  if (!window._usedQuizQuestions) window._usedQuizQuestions = [];
  window._usedQuizQuestions = []; // reset for a fresh quiz
  window._currentQuizQuestions = []; // reset master list

  const container = containerOverride || null;

  function showProgress(done, total) {
    const msg = `Generating questions… ${done}/${total}`;
    if (container) {
      container.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:48px;color:rgba(255,255,255,0.5);">
        <div style="width:40px;height:40px;border:3px solid rgba(102,126,234,0.3);border-top-color:#667eea;border-radius:50%;animation:spin 0.9s linear infinite;"></div>
        <div style="font-size:14px;">${msg}</div>
      </div>`;
    } else {
      const el = document.getElementById('loading-modal-msg');
      if (el) el.textContent = msg;
    }
  }

  if (container) {
    showProgress(0, count);
  } else {
    showLoadingModal(`Generating ${count} questions (${quizMode === 'situational' ? 'situational' : difficulty})...`, 'AI is building your exam');
  }

  try {
    const questions = await _fetchAllQuizQuestions(slides, count, difficulty, quizMode, [], showProgress);

    if (!container) hideLoadingModal();

    // Update used-question tracker
    questions.forEach(q => {
      const t = (q.question || '').substring(0, 80);
      if (t && !window._usedQuizQuestions.includes(t)) window._usedQuizQuestions.push(t);
    });

    // Store master list
    window._currentQuizQuestions = questions.slice();

    // Renumber questions from 1
    questions.forEach((q, i) => q.number = i + 1);

    // Save to library
    _saveQuizToLibrary(questions, difficulty, quizMode);

    if (container) {
      mountMaterialExamPlayer(container, questions, difficulty, slides, quizMode);
    } else {
      displayGeneratedMaterials({ quiz: '', _parsedQuestions: JSON.stringify(questions), _difficulty: difficulty, _quizMode: quizMode }, 'quiz', null, questions, difficulty, quizMode);
    }
  } catch(err) {
    if (!container) hideLoadingModal();
    const msg = `❌ Error: ${err.message}`;
    if (container) container.innerHTML = `<div style="padding:24px;color:#f87171;text-align:center;">${msg}</div>`;
    else _showToast(msg);
  }
}

// ── Append MORE questions to the existing player (Generate More) ─────────────
async function appendMaterialQuiz() {
  const container = document.getElementById('mat-exam-player');
  if (!container) return;

  const difficulty = window._matQuizDifficulty || 'medium';
  const addCount   = window._matQuizCount      || 10;
  const quizMode   = window._matQuizMode       || 'standard';
  const slides     = window.currentSlides;

  if (!window._usedQuizQuestions)    window._usedQuizQuestions    = [];
  if (!window._currentQuizQuestions) window._currentQuizQuestions = [];

  // Show spinner appended at the bottom of the player (don't wipe existing questions)
  const spinId = 'append-spinner-' + Date.now();
  const spinDiv = document.createElement('div');
  spinDiv.id = spinId;
  spinDiv.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:10px;padding:32px;color:rgba(255,255,255,0.4);';
  spinDiv.innerHTML = `
    <div style="width:36px;height:36px;border:3px solid rgba(102,126,234,0.25);border-top-color:#667eea;border-radius:50%;animation:spin 0.9s linear infinite;"></div>
    <div id="${spinId}-msg" style="font-size:13px;">Fetching ${addCount} more questions…</div>`;
  container.appendChild(spinDiv);
  container.scrollTop = container.scrollHeight;

  try {
    const newQs = await _fetchAllQuizQuestions(
      slides, addCount, difficulty, quizMode,
      window._usedQuizQuestions,
      (done, total) => {
        const el = document.getElementById(spinId + '-msg');
        if (el) el.textContent = `Fetching more… ${done}/${total}`;
      }
    );

    // Remove spinner
    document.getElementById(spinId)?.remove();

    if (!newQs.length) { _showToast('⚠️ No new questions could be generated. Try a different difficulty.'); return; }

    // Update used tracker
    newQs.forEach(q => {
      const t = (q.question || '').substring(0, 80);
      if (t && !window._usedQuizQuestions.includes(t)) window._usedQuizQuestions.push(t);
    });

    // Find the existing exam list to append into
    // The ts is stored on the container's dataset
    const ts     = container.dataset.examTs;
    const listEl = document.getElementById(`matexam-list-${ts}`);
    const scoreEl= document.getElementById(`matexam-score-${ts}`);
    const resultEl = document.getElementById(`matexam-result-${ts}`);

    // Calculate current total BEFORE adding
    const prevTotal = window._currentQuizQuestions.length;

    // Renumber new questions continuing from where we left off
    newQs.forEach((q, i) => q.number = prevTotal + i + 1);

    // Append to master list
    window._currentQuizQuestions = window._currentQuizQuestions.concat(newQs);
    const grandTotal = window._currentQuizQuestions.length;

    // Append question HTML into the existing list
    if (listEl) {
      newQs.forEach((q, idx) => {
        const globalIdx = prevTotal + idx;
        const qId = `meq-${ts}-${globalIdx}`;
        const div = document.createElement('div');
        div.className = 'exam-question';
        div.id = qId;
        const ans = (q.answer || '').trim().charAt(0).toUpperCase();
        div.innerHTML = `
          <div class="exam-q-num">Q${q.number}</div>
          <div class="exam-q-text">${q.question}</div>
          <div class="exam-options">
            ${['A','B','C','D'].map(letter => {
              const opt = q.options[letter];
              if (!opt) return '';
              return `<button class="exam-option" data-letter="${letter}" data-qid="${qId}"
                data-answer="${ans}" data-examts="${ts}" onclick="handleMatExamAnswer(this)">
                ${letter}) ${opt}
              </button>`;
            }).join('')}
          </div>
          <div class="exam-explanation" id="${qId}-exp" style="display:none;">
            <strong>Answer: ${q.answer}</strong>${q.explanation ? ' — ' + q.explanation : ''}
          </div>`;
        listEl.appendChild(div);
      });

      // Update total in dataset so score tally stays correct
      container.dataset.examTotal = grandTotal;

      // Update the score counter to reflect new total
      if (scoreEl) {
        const answeredCorrect = parseInt(scoreEl.textContent) || 0;
        // Re-tally from DOM
        const allQsNow = listEl.querySelectorAll('.exam-question');
        let correct = 0;
        allQsNow.forEach(el => {
          if (el.querySelector('.exam-correct')) correct++;
        });
        scoreEl.textContent = `${correct} / ${grandTotal} correct`;
      }

      // Hide any old result banner since there are new questions
      if (resultEl) resultEl.style.display = 'none';

      // Update the "X questions" badge in the exam header
      const headerQCount = container.querySelector('.exam-header span[style*="rgba(255,255,255,0.4)"]');
      if (headerQCount) headerQCount.textContent = grandTotal + ' questions';

      // Scroll to first new question
      const firstNew = document.getElementById(`meq-${ts}-${prevTotal}`);
      if (firstNew) firstNew.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // Save updated quiz to library
    _saveQuizToLibrary(window._currentQuizQuestions, difficulty, quizMode);

  } catch(err) {
    document.getElementById(spinId)?.remove();
    const errDiv = document.createElement('div');
    errDiv.style.cssText = 'padding:16px;color:#f87171;text-align:center;font-size:13px;';
    errDiv.textContent = '❌ ' + err.message;
    container.appendChild(errDiv);
  }
}

function _saveQuizToLibrary(questions, difficulty, quizMode) {
  const saveFilename = window._currentUploadFilename || 'Uploaded File';
  saveMaterialToLibrary({
    quiz: '',
    _parsedQuestions: JSON.stringify(questions),
    _difficulty: difficulty,
    _quizMode: quizMode,
    _questionCount: questions.length
  }, 'quiz', saveFilename);
}

function displayGeneratedMaterials(materials, type, savedTitle, parsedQuestions, initialDifficulty, initialQuizMode) {
  const existing = document.getElementById('materials-display-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'materials-display-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;z-index:10000;backdrop-filter:blur(4px);';

  // ── Build tabs ──────────────────────────────────────────────────────────
  const TAB_META = {
    notes:      { label:'Study Notes',    icon:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/></svg>', color:'#63b3ed' },
    reviewer:   { label:'Exam Reviewer',  icon:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>', color:'#fc814a' },
    flashcards: { label:'Flashcards',     icon:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>', color:'#9a75ea' },
    summary:    { label:'Summary Sheet',  icon:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg>', color:'#48bb78' },
    quiz:       { label:'Practice Quiz',  icon:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>', color:'#ed8936' },
    blank:      { label:'My Notes',       icon:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>', color:'#f6ad55' },
  };

  // Filter out internal metadata keys (prefixed with _)
  const keys = Object.keys(materials).filter(k => !k.startsWith('_'));
  let tabsHTML = '';
  let pagesHTML = '';

  keys.forEach((key, i) => {
    const meta = TAB_META[key] || { label: key.toUpperCase(), icon: '', color: '#94a3b8' };
    const isFirst = i === 0;
    tabsHTML += `
      <button class="doc-tab" id="doctab-${key}" onclick="switchDocTab('${key}')"
        style="display:inline-flex;align-items:center;gap:7px;padding:9px 16px;border:none;border-radius:8px 8px 0 0;
        cursor:pointer;font-size:12.5px;font-weight:600;transition:all 0.18s;white-space:nowrap;
        background:${isFirst ? 'white' : 'rgba(255,255,255,0.06)'};
        color:${isFirst ? meta.color : 'rgba(255,255,255,0.45)'};
        border-bottom:${isFirst ? '2px solid ' + meta.color : 'none'};
        " data-color="${meta.color}">
        <span style="color:${meta.color}">${meta.icon}</span>${meta.label}
      </button>`;

    if (key === 'quiz') {
      // ── Quiz tab: interactive exam player ────────────────────────────────
      pagesHTML += `
        <div id="docpage-quiz" class="doc-page-wrap" style="display:${isFirst?'flex':'none'};flex-direction:column;height:100%;background:#0f172a;overflow-y:auto;">
          <!-- Quiz toolbar -->
          <div style="background:#1e293b;border-bottom:1px solid rgba(255,255,255,0.07);padding:10px 20px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;position:sticky;top:0;z-index:5;flex-shrink:0;">
            <span style="font-size:11px;font-weight:700;letter-spacing:1px;color:rgba(255,255,255,0.3);text-transform:uppercase;">Difficulty:</span>
            ${['easy','medium','hard'].map(d => `
              <button id="mat-diff-${d}" onclick="setMatQuizDifficulty('${d}')"
                style="padding:5px 12px;border-radius:20px;font-size:11px;font-weight:700;cursor:pointer;transition:all 0.15s;border:1px solid;
                border-color:${d===(initialDifficulty||'medium')?{'easy':'#4ade80','medium':'#fbbf24','hard':'#f87171'}[d]:'rgba(255,255,255,0.12)'};
                background:${d===(initialDifficulty||'medium')?{'easy':'rgba(74,222,128,0.15)','medium':'rgba(251,191,36,0.15)','hard':'rgba(248,113,113,0.15)'}[d]:'rgba(255,255,255,0.04)'};
                color:${d===(initialDifficulty||'medium')?{'easy':'#4ade80','medium':'#fbbf24','hard':'#f87171'}[d]:'rgba(255,255,255,0.4)'}">
                ${{easy:'Easy',medium:'Medium',hard:'Hard'}[d]}
              </button>`).join('')}
            <div style="width:1px;height:20px;background:rgba(255,255,255,0.1);margin:0 4px;"></div>
            <span style="font-size:11px;font-weight:700;letter-spacing:1px;color:rgba(255,255,255,0.3);text-transform:uppercase;">Questions:</span>
            ${[5,10,15,20,30,50].map(n => `
              <button id="mat-qn-${n}" onclick="setMatQuizCount(${n})"
                style="min-width:34px;height:26px;padding:0 6px;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;transition:all 0.15s;border:1px solid;
                border-color:${n===10?'#667eea':'rgba(255,255,255,0.12)'};
                background:${n===10?'rgba(102,126,234,0.2)':'rgba(255,255,255,0.04)'};
                color:${n===10?'#a5b4fc':'rgba(255,255,255,0.4)'}">${n}</button>`).join('')}
            <div style="width:1px;height:20px;background:rgba(255,255,255,0.1);margin:0 4px;"></div>
            <span style="font-size:11px;font-weight:700;letter-spacing:1px;color:rgba(255,255,255,0.3);text-transform:uppercase;">Mode:</span>
            <button id="mat-mode-standard" onclick="setMatQuizMode('standard')"
              style="padding:5px 12px;border-radius:20px;font-size:11px;font-weight:700;cursor:pointer;transition:all 0.15s;border:1px solid rgba(102,126,234,0.7);background:rgba(102,126,234,0.2);color:#a5b4fc;">
              Standard
            </button>
            <button id="mat-mode-situational" onclick="setMatQuizMode('situational')"
              style="padding:5px 12px;border-radius:20px;font-size:11px;font-weight:700;cursor:pointer;transition:all 0.15s;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:rgba(255,255,255,0.4);">
              🎭 Situational
            </button>
            <button onclick="regenMaterialQuiz()" style="margin-left:auto;padding:6px 14px;background:linear-gradient(135deg,#667eea,#764ba2);border:none;border-radius:8px;color:white;font-size:12px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:6px;white-space:nowrap;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>
              + Add Questions
            </button>
          </div>
          <!-- Exam player area -->
          <div id="mat-exam-player" style="flex:1;padding:24px;overflow-y:auto;"></div>
        </div>`;
      // ── Flashcards tab: interactive flip-card player ──────────────────────
      pagesHTML += `
        <div id="docpage-flashcards" class="doc-page-wrap" style="display:${isFirst?'flex':'none'};flex-direction:column;height:100%;background:#0f172a;overflow-y:auto;align-items:center;justify-content:flex-start;padding:32px 16px;">
          <div id="fc-player-root" style="width:100%;max-width:620px;"></div>
        </div>`;
    } else {
      const isNotes = key === 'notes' || key === 'blank';
      pagesHTML += `
        <div id="docpage-${key}" class="doc-page-wrap" style="display:${isFirst?'flex':'none'};flex-direction:column;height:100%;background:#e8edf4;overflow-y:auto;">
          <!-- Toolbar -->
          <div style="background:#1e293b;border-bottom:1px solid rgba(255,255,255,0.07);padding:8px 20px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;position:sticky;top:0;z-index:5;">
            <span style="font-size:10px;font-weight:700;letter-spacing:1px;color:rgba(255,255,255,0.3);text-transform:uppercase;margin-right:4px;">Format</span>
            <button onclick="document.execCommand('bold')" title="Bold" style="width:30px;height:30px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:white;cursor:pointer;font-weight:700;font-size:13px;display:flex;align-items:center;justify-content:center;transition:all 0.15s;" onmouseenter="this.style.background='rgba(102,126,234,0.3)'" onmouseleave="this.style.background='rgba(255,255,255,0.07)'">B</button>
            <button onclick="document.execCommand('italic')" title="Italic" style="width:30px;height:30px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:white;cursor:pointer;font-style:italic;font-size:13px;display:flex;align-items:center;justify-content:center;transition:all 0.15s;" onmouseenter="this.style.background='rgba(102,126,234,0.3)'" onmouseleave="this.style.background='rgba(255,255,255,0.07)'">I</button>
            <button onclick="document.execCommand('underline')" title="Underline" style="width:30px;height:30px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:white;cursor:pointer;text-decoration:underline;font-size:13px;display:flex;align-items:center;justify-content:center;transition:all 0.15s;" onmouseenter="this.style.background='rgba(102,126,234,0.3)'" onmouseleave="this.style.background='rgba(255,255,255,0.07)'">U</button>
            <div style="width:1px;height:20px;background:rgba(255,255,255,0.1);margin:0 2px;"></div>
            <button onclick="document.execCommand('insertUnorderedList')" style="height:30px;padding:0 10px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:rgba(255,255,255,0.7);cursor:pointer;font-size:12px;display:flex;align-items:center;gap:5px;transition:all 0.15s;" onmouseenter="this.style.background='rgba(102,126,234,0.3)'" onmouseleave="this.style.background='rgba(255,255,255,0.07)'">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="9" x2="21" y1="6" y2="6"/><line x1="9" x2="21" y1="12" y2="12"/><line x1="9" x2="21" y1="18" y2="18"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/></svg>
              Bullets
            </button>
            <button onclick="document.execCommand('insertOrderedList')" style="height:30px;padding:0 10px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:rgba(255,255,255,0.7);cursor:pointer;font-size:12px;display:flex;align-items:center;gap:5px;transition:all 0.15s;" onmouseenter="this.style.background='rgba(102,126,234,0.3)'" onmouseleave="this.style.background='rgba(255,255,255,0.07)'">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="10" x2="21" y1="6" y2="6"/><line x1="10" x2="21" y1="12" y2="12"/><line x1="10" x2="21" y1="18" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/></svg>
              Numbered
            </button>
            <div style="width:1px;height:20px;background:rgba(255,255,255,0.1);margin:0 2px;"></div>
            <select onchange="document.execCommand('fontSize',false,this.value);this.value=''" style="height:30px;padding:0 6px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:rgba(255,255,255,0.7);cursor:pointer;font-size:12px;outline:none;">
              <option value="">Size</option><option value="2">Small</option><option value="3">Normal</option><option value="4">Large</option><option value="5">X-Large</option>
            </select>
            <div style="margin-left:auto;">
              <button onclick="addBlankPageToDoc('${key}')" style="height:30px;padding:0 12px;background:rgba(99,102,241,0.2);border:1px solid rgba(99,102,241,0.3);border-radius:6px;color:rgba(167,139,250,0.9);cursor:pointer;font-size:12px;font-weight:600;display:flex;align-items:center;gap:5px;transition:all 0.15s;" onmouseenter="this.style.background='rgba(99,102,241,0.35)'" onmouseleave="this.style.background='rgba(99,102,241,0.2)'">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="12" x2="12" y1="13" y2="19"/><line x1="9" x2="15" y1="16" y2="16"/></svg>
                Add Page
              </button>
            </div>
          </div>
          <!-- Paper -->
          <div style="flex:1;padding:32px 24px 60px;overflow-y:auto;" id="docscroll-${key}">
            <div contenteditable="true" spellcheck="false" id="doceditor-${key}" style="
              background:${isNotes ? '#fffef5' : '#ffffff'};
              color:#1a1a1a;max-width:780px;min-height:1000px;margin:0 auto;
              padding:64px 72px;border-radius:3px;outline:none;
              box-shadow:0 2px 8px rgba(0,0,0,0.08),0 12px 40px rgba(0,0,0,0.14);
              font-family:'Segoe UI',sans-serif;font-size:12pt;line-height:1.75;
              ${isNotes ? 'background-image:repeating-linear-gradient(transparent,transparent 27px,rgba(91,141,238,0.07) 27px,rgba(91,141,238,0.07) 28px);background-attachment:local;' : ''}
            ">${formatMaterialContent(materials[key], key)}</div>
          </div>
        </div>`;
    }
  });

  // ── Determine display title ─────────────────────────────────────────────
  const docTitle = savedTitle || (window._currentUploadFilename ? window._currentUploadFilename.replace(/\.[^.]+$/,'') : 'Document');

  modal.innerHTML = `
    <div style="background:#0f172a;border-radius:16px;width:96%;max-width:1160px;height:92vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 32px 80px rgba(0,0,0,0.7);border:1px solid rgba(255,255,255,0.07);">

      <!-- Header -->
      <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 20px;background:#0f172a;border-bottom:1px solid rgba(255,255,255,0.07);flex-shrink:0;">
        <div style="display:flex;align-items:center;gap:12px;min-width:0;">
          <div style="width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#667eea,#764ba2);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
          </div>
          <div style="min-width:0;">
            <!-- Editable title -->
            <div style="display:flex;align-items:center;gap:6px;">
              <span id="doc-title-display" style="color:white;font-size:15px;font-weight:700;cursor:pointer;border-radius:5px;padding:2px 6px;transition:background 0.15s;max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="Click to rename" onclick="startRenameDoc()" onmouseenter="this.style.background='rgba(255,255,255,0.08)'" onmouseleave="this.style.background='transparent'">${docTitle}</span>
              <input id="doc-title-input" style="display:none;background:rgba(255,255,255,0.08);border:1px solid rgba(102,126,234,0.5);border-radius:6px;padding:3px 8px;color:white;font-size:15px;font-weight:700;outline:none;width:260px;" onblur="finishRenameDoc()" onkeydown="if(event.key==='Enter')finishRenameDoc();if(event.key==='Escape')cancelRenameDoc()">
              <button onclick="startRenameDoc()" title="Rename" style="background:none;border:none;color:rgba(255,255,255,0.25);cursor:pointer;padding:3px;border-radius:4px;display:flex;align-items:center;transition:color 0.15s;" onmouseenter="this.style.color='rgba(102,126,234,0.8)'" onmouseleave="this.style.color='rgba(255,255,255,0.25)'">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
              </button>
            </div>
            <div style="color:rgba(255,255,255,0.3);font-size:11px;margin-top:1px;padding-left:6px;">Click title to rename · Click paper to edit</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
          <!-- Add blank notes tab -->
          <button onclick="addBlankNotesTab()" title="New blank page" style="height:36px;padding:0 14px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:9px;color:rgba(255,255,255,0.6);cursor:pointer;font-size:12.5px;font-weight:600;display:flex;align-items:center;gap:7px;transition:all 0.18s;" onmouseenter="this.style.background='rgba(255,255,255,0.1)'" onmouseleave="this.style.background='rgba(255,255,255,0.06)'">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="12" x2="12" y1="13" y2="19"/><line x1="9" x2="15" y1="16" y2="16"/></svg>
            New Page
          </button>
          <div style="position:relative;display:inline-flex;gap:0;">
            <button onclick="downloadMaterials()" style="height:36px;padding:0 16px;background:linear-gradient(135deg,#667eea,#764ba2);border:none;border-radius:9px 0 0 9px;color:white;font-size:12.5px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:7px;box-shadow:0 4px 14px rgba(102,126,234,0.35);transition:all 0.18s;" onmouseenter="this.style.opacity='0.9'" onmouseleave="this.style.opacity='1'">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
              Download
            </button>
            <button onclick="toggleDownloadMenu(event)" style="height:36px;padding:0 10px;background:linear-gradient(135deg,#5a6fd6,#6b42a0);border:none;border-left:1px solid rgba(255,255,255,0.2);border-radius:0 9px 9px 0;color:white;font-size:11px;cursor:pointer;transition:all 0.18s;" onmouseenter="this.style.opacity='0.85'" onmouseleave="this.style.opacity='1'" title="More download options">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><path d="m6 9 6 6 6-6"/></svg>
            </button>
            <div id="download-menu" style="display:none;position:absolute;top:42px;right:0;background:#1e293b;border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:5px;min-width:200px;box-shadow:0 12px 36px rgba(0,0,0,0.6);z-index:9999;">
              <button onclick="downloadMaterials();closeDownloadMenu();" style="width:100%;padding:9px 14px;background:none;border:none;color:rgba(255,255,255,0.8);font-size:13px;cursor:pointer;border-radius:8px;text-align:left;display:flex;align-items:center;gap:9px;transition:background 0.15s;" onmouseenter="this.style.background='rgba(255,255,255,0.07)'" onmouseleave="this.style.background='none'">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                Export as PDF (Print)
              </button>
              <button onclick="downloadMaterialsAsText();closeDownloadMenu();" style="width:100%;padding:9px 14px;background:none;border:none;color:rgba(255,255,255,0.8);font-size:13px;cursor:pointer;border-radius:8px;text-align:left;display:flex;align-items:center;gap:9px;transition:background 0.15s;" onmouseenter="this.style.background='rgba(255,255,255,0.07)'" onmouseleave="this.style.background='none'">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
                Download as .txt
              </button>
              <button onclick="downloadMaterialsAsHTML();closeDownloadMenu();" style="width:100%;padding:9px 14px;background:none;border:none;color:rgba(255,255,255,0.8);font-size:13px;cursor:pointer;border-radius:8px;text-align:left;display:flex;align-items:center;gap:9px;transition:background 0.15s;" onmouseenter="this.style.background='rgba(255,255,255,0.07)'" onmouseleave="this.style.background='none'">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2"><path d="M4 4h16v16H4z"/><path d="m9 9-2 3 2 3"/><path d="m15 9 2 3-2 3"/></svg>
                Download as .html
              </button>
            </div>
          </div>
          <button onclick="closeMaterialsDisplay()" style="height:36px;padding:0 14px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:9px;color:rgba(255,255,255,0.6);cursor:pointer;font-size:12.5px;display:flex;align-items:center;gap:6px;transition:all 0.18s;" onmouseenter="this.style.background='rgba(248,113,113,0.15)';this.style.color='#f87171'" onmouseleave="this.style.background='rgba(255,255,255,0.06)';this.style.color='rgba(255,255,255,0.6)'">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            Close
          </button>
        </div>
      </div>

      <!-- Tab bar -->
      <div id="doc-tabbar" style="display:flex;align-items:flex-end;gap:3px;padding:12px 20px 0;background:#1e293b;border-bottom:1px solid rgba(255,255,255,0.06);overflow-x:auto;flex-shrink:0;">
        ${tabsHTML}
      </div>

      <!-- Page content area -->
      <div id="doc-pages" style="flex:1;overflow:hidden;position:relative;">
        ${pagesHTML}
      </div>
    </div>
  `;

  // Store current doc info for rename/save
  modal._materials = materials;
  modal._type = type;
  modal._title = docTitle;

  document.body.appendChild(modal);
  // Activate first tab
  if (keys.length > 0) switchDocTab(keys[0]);

  // ── Boot interactive players ──────────────────────────────────────────────
  // Quiz tab
  const examPlayerEl = document.getElementById('mat-exam-player');
  if (examPlayerEl) {
    window._matQuizDifficulty = initialDifficulty || 'medium';
    window._matQuizMode       = initialQuizMode   || 'standard';
    window._matQuizCount = (parsedQuestions && parsedQuestions.length) || 10;
    if (parsedQuestions && parsedQuestions.length > 0) {
      mountMaterialExamPlayer(examPlayerEl, parsedQuestions, window._matQuizDifficulty, window.currentSlides, window._matQuizMode);
    } else {
      // Auto-generate on first open
      startMaterialQuiz(window.currentSlides, examPlayerEl);
    }
  }
  // Flashcards tab
  if (materials.flashcards) {
    const fcRoot = document.getElementById('fc-player-root');
    if (fcRoot) {
      const parsed = parseMaterialFlashcards(materials.flashcards);
      if (parsed.length > 0) {
        const docTitle2 = savedTitle || (window._currentUploadFilename ? window._currentUploadFilename.replace(/\.[^.]+$/,'') : 'Flashcards');
        mountMaterialFlashcardPlayer(fcRoot, parsed, docTitle2);
      }
    }
  }
}
function switchDocTab(key) {
  document.querySelectorAll('.doc-tab').forEach(btn => {
    const isActive = btn.id === 'doctab-' + key;
    const color = btn.dataset.color || '#94a3b8';
    btn.style.background = isActive ? 'white' : 'rgba(255,255,255,0.06)';
    btn.style.color = isActive ? color : 'rgba(255,255,255,0.4)';
    btn.style.borderBottom = isActive ? '2px solid ' + color : 'none';
  });
  document.querySelectorAll('.doc-page-wrap').forEach(p => p.style.display = 'none');
  const page = document.getElementById('docpage-' + key);
  if (page) page.style.display = 'flex';
}

// ── Add blank page within current tab (appends a ruled page below) ──────────
function addBlankPageToDoc(key) {
  const editor = document.getElementById('doceditor-' + key);
  if (!editor) return;
  const sep = document.createElement('div');
  sep.style.cssText = 'height:1px;background:rgba(91,141,238,0.15);margin:48px 0;';
  editor.appendChild(sep);
  const newPage = document.createElement('div');
  newPage.style.cssText = 'min-height:600px;padding-top:24px;';
  newPage.innerHTML = '<br>';
  editor.appendChild(newPage);
  newPage.focus();
  const range = document.createRange();
  range.selectNodeContents(newPage);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  editor.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

// ── Add a brand-new blank "My Notes" tab ────────────────────────────────────
let _blankTabCount = 0;
function addBlankNotesTab() {
  _blankTabCount++;
  const key = 'blank' + _blankTabCount;
  const tabBar = document.getElementById('doc-tabbar');
  const pages  = document.getElementById('doc-pages');
  if (!tabBar || !pages) return;

  const newTab = document.createElement('button');
  newTab.className = 'doc-tab';
  newTab.id = 'doctab-' + key;
  newTab.dataset.color = '#f6ad55';
  newTab.style.cssText = 'display:inline-flex;align-items:center;gap:7px;padding:9px 16px;border:none;border-radius:8px 8px 0 0;cursor:pointer;font-size:12.5px;font-weight:600;transition:all 0.18s;white-space:nowrap;background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.45);';
  newTab.innerHTML = `<span style="color:#f6ad55"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></span>My Notes ${_blankTabCount}`;
  newTab.onclick = () => switchDocTab(key);
  tabBar.appendChild(newTab);

  const newPage = document.createElement('div');
  newPage.id = 'docpage-' + key;
  newPage.className = 'doc-page-wrap';
  newPage.style.cssText = 'display:none;flex-direction:column;height:100%;background:#e8edf4;overflow-y:auto;';
  newPage.innerHTML = `
    <div style="background:#1e293b;border-bottom:1px solid rgba(255,255,255,0.07);padding:8px 20px;display:flex;align-items:center;gap:6px;position:sticky;top:0;z-index:5;">
      <span style="font-size:10px;font-weight:700;letter-spacing:1px;color:rgba(255,255,255,0.3);text-transform:uppercase;margin-right:4px;">Format</span>
      <button onclick="document.execCommand('bold')" style="width:30px;height:30px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:white;cursor:pointer;font-weight:700;font-size:13px;display:flex;align-items:center;justify-content:center;" onmouseenter="this.style.background='rgba(102,126,234,0.3)'" onmouseleave="this.style.background='rgba(255,255,255,0.07)'">B</button>
      <button onclick="document.execCommand('italic')" style="width:30px;height:30px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:white;cursor:pointer;font-style:italic;font-size:13px;display:flex;align-items:center;justify-content:center;" onmouseenter="this.style.background='rgba(102,126,234,0.3)'" onmouseleave="this.style.background='rgba(255,255,255,0.07)'">I</button>
      <button onclick="document.execCommand('underline')" style="width:30px;height:30px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:white;cursor:pointer;text-decoration:underline;font-size:13px;display:flex;align-items:center;justify-content:center;" onmouseenter="this.style.background='rgba(102,126,234,0.3)'" onmouseleave="this.style.background='rgba(255,255,255,0.07)'">U</button>
      <div style="width:1px;height:20px;background:rgba(255,255,255,0.1);margin:0 2px;"></div>
      <button onclick="document.execCommand('insertUnorderedList')" style="height:30px;padding:0 10px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:rgba(255,255,255,0.7);cursor:pointer;font-size:12px;display:flex;align-items:center;gap:5px;" onmouseenter="this.style.background='rgba(102,126,234,0.3)'" onmouseleave="this.style.background='rgba(255,255,255,0.07)'">• Bullets</button>
      <button onclick="document.execCommand('insertOrderedList')" style="height:30px;padding:0 10px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:rgba(255,255,255,0.7);cursor:pointer;font-size:12px;display:flex;align-items:center;gap:5px;" onmouseenter="this.style.background='rgba(102,126,234,0.3)'" onmouseleave="this.style.background='rgba(255,255,255,0.07)'">1. Numbered</button>
      <div style="margin-left:auto;">
        <button onclick="addBlankPageToDoc('${key}')" style="height:30px;padding:0 12px;background:rgba(99,102,241,0.2);border:1px solid rgba(99,102,241,0.3);border-radius:6px;color:rgba(167,139,250,0.9);cursor:pointer;font-size:12px;font-weight:600;display:flex;align-items:center;gap:5px;" onmouseenter="this.style.background='rgba(99,102,241,0.35)'" onmouseleave="this.style.background='rgba(99,102,241,0.2)'">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="12" x2="12" y1="5" y2="19"/><line x1="5" x2="19" y1="12" y2="12"/></svg> Add Page
        </button>
      </div>
    </div>
    <div style="flex:1;padding:32px 24px 60px;overflow-y:auto;">
      <div contenteditable="true" spellcheck="false" id="doceditor-${key}" style="background:#fffef5;color:#1a1a1a;max-width:780px;min-height:1000px;margin:0 auto;padding:64px 72px;border-radius:3px;outline:none;box-shadow:0 2px 8px rgba(0,0,0,0.08),0 12px 40px rgba(0,0,0,0.14);font-family:'Segoe UI',sans-serif;font-size:12pt;line-height:1.75;background-image:repeating-linear-gradient(transparent,transparent 27px,rgba(91,141,238,0.07) 27px,rgba(91,141,238,0.07) 28px);background-attachment:local;">
        <p style="color:#aaa;font-style:italic;">Start writing your notes here…</p>
      </div>
    </div>
  `;
  pages.appendChild(newPage);
  switchDocTab(key);
}

// ── Rename doc title ─────────────────────────────────────────────────────────
function startRenameDoc() {
  const display = document.getElementById('doc-title-display');
  const input   = document.getElementById('doc-title-input');
  if (!display || !input) return;
  input.value = display.textContent;
  display.style.display = 'none';
  input.style.display = 'block';
  input.focus();
  input.select();
}
function finishRenameDoc() {
  const display = document.getElementById('doc-title-display');
  const input   = document.getElementById('doc-title-input');
  if (!display || !input) return;
  const newTitle = input.value.trim() || display.textContent;
  display.textContent = newTitle;
  display.style.display = '';
  input.style.display = 'none';
  // Persist rename in saved library
  const modal = document.getElementById('materials-display-modal');
  if (modal && modal._materials) {
    renameSavedMaterial(modal._materials, modal._type, newTitle);
  }
}
function cancelRenameDoc() {
  const display = document.getElementById('doc-title-display');
  const input   = document.getElementById('doc-title-input');
  if (!display || !input) return;
  display.style.display = '';
  input.style.display = 'none';
}


function formatMaterialContent(content, type) {
  if (type === 'notes') {
    // Aesthetic lecture-notes style inspired by colorful handwritten notes
    let formatted = content
      // H1 - big colored header with underline bar (like a title heading)
      .replace(/^# (.+)$/gm, `<h1 style="
        font-family: 'Georgia', serif;
        font-size: 26px;
        font-weight: 800;
        color: #1e3a5f;
        margin: 36px 0 4px 0;
        padding-bottom: 8px;
        border-bottom: 4px solid #5b8dee;
        letter-spacing: -0.5px;
      ">$1</h1>`)
      // H2 - colored section header with left accent bar
      .replace(/^## (.+)$/gm, `<h2 style="
        font-family: 'Georgia', serif;
        font-size: 19px;
        font-weight: 700;
        color: #2d3a8c;
        margin: 28px 0 8px 0;
        padding: 6px 12px;
        background: rgba(91,141,238,0.08);
        border-left: 4px solid #5b8dee;
        border-radius: 0 8px 8px 0;
      ">$1</h2>`)
      // H3 - pink/coral accent heading
      .replace(/^### (.+)$/gm, `<h3 style="
        font-size: 15px;
        font-weight: 700;
        color: #c2185b;
        margin: 20px 0 6px 0;
        padding-left: 10px;
        border-left: 3px solid #f48fb1;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      ">$1</h3>`)
      // Bold text → highlighted span (yellow highlight like a marker)
      .replace(/\*\*(.+?)\*\*/g, `<strong style="
        background: linear-gradient(120deg, #fff176 0%, #fff9c4 100%);
        padding: 1px 4px;
        border-radius: 3px;
        color: #1a1a1a;
        font-weight: 700;
      ">$1</strong>`)
      // Italic text → colored
      .replace(/\*(.+?)\*/g, `<em style="color: #5c6bc0; font-style: italic;">$1</em>`)
      // Bullet list items → styled with colored bullet
      .replace(/^[-•] (.+)$/gm, `<div style="
        display: flex;
        align-items: flex-start;
        gap: 10px;
        margin: 5px 0;
        padding-left: 8px;
      "><span style="color:#5b8dee;font-size:16px;line-height:1.4;flex-shrink:0;">◆</span><span style="color:#2c2c2c;line-height:1.6;">$1</span></div>`)
      // Numbered list
      .replace(/^(\d+)\. (.+)$/gm, `<div style="
        display: flex;
        align-items: flex-start;
        gap: 10px;
        margin: 5px 0;
        padding-left: 4px;
      "><span style="
        background:#5b8dee;color:white;font-size:11px;font-weight:700;
        width:20px;height:20px;border-radius:50%;display:flex;align-items:center;
        justify-content:center;flex-shrink:0;margin-top:2px;
      ">$1</span><span style="color:#2c2c2c;line-height:1.6;">$2</span></div>`)
      // Double newlines → paragraph break
      .replace(/\n\n/g, '<div style="margin:10px 0;"></div>');

    return `<div style="font-family: 'Segoe UI', sans-serif; font-size: 13px; color: #2c2c2c; line-height: 1.7;">${formatted}</div>`;
  }

  // For reviewer, summary, quiz, all - clean professional style
  let formatted = content
    .replace(/^# (.+)$/gm, '<h1 style="color:#0f172a;font-size:22px;font-weight:800;margin:32px 0 8px;border-bottom:3px solid #e2e8f0;padding-bottom:8px;">$1</h1>')
    .replace(/^## (.+)$/gm, '<h2 style="color:#1e293b;font-size:17px;font-weight:700;margin:24px 0 8px;border-bottom:2px solid #e2e8f0;padding-bottom:6px;">$1</h2>')
    .replace(/^### (.+)$/gm, '<h3 style="color:#334155;font-size:14px;font-weight:700;margin:16px 0 6px;text-transform:uppercase;letter-spacing:0.5px;">$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^[-•] (.+)$/gm, '<li style="margin-bottom:6px;padding-left:4px;">$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li style="margin-bottom:8px;">$2</li>')
    .replace(/\n\n/g, '<br><br>');

  // Wrap consecutive <li> tags
  formatted = formatted.replace(/((?:<li[^>]*>.*?<\/li>\s*)+)/gs, '<ul style="padding-left:20px;margin:10px 0;">$1</ul>');

  return `<div style="font-family:'Segoe UI',sans-serif;font-size:12pt;color:#1a1a1a;line-height:1.7;">${formatted}</div>`;
}

// ═══════════════════════════════════════════════════════════════════════════
//  MATERIAL EXAM PLAYER  (reusable — mounts into any DOM element)
// ═══════════════════════════════════════════════════════════════════════════

function setMatQuizDifficulty(level) {
  window._matQuizDifficulty = level;
  const colors = { easy:'#4ade80', medium:'#fbbf24', hard:'#f87171' };
  ['easy','medium','hard'].forEach(d => {
    const btn = document.getElementById(`mat-diff-${d}`);
    if (!btn) return;
    const col = colors[d]; const active = d === level;
    btn.style.borderColor = active ? col : 'rgba(255,255,255,0.12)';
    btn.style.background  = active ? `${col}26` : 'rgba(255,255,255,0.04)';
    btn.style.color       = active ? col : 'rgba(255,255,255,0.4)';
  });
}

function setMatQuizCount(n) {
  window._matQuizCount = n;
  [5,10,15,20,30,50].forEach(c => {
    const btn = document.getElementById(`mat-qn-${c}`);
    if (!btn) return;
    const active = c === n;
    btn.style.borderColor = active ? '#667eea' : 'rgba(255,255,255,0.12)';
    btn.style.background  = active ? 'rgba(102,126,234,0.2)' : 'rgba(255,255,255,0.04)';
    btn.style.color       = active ? '#a5b4fc' : 'rgba(255,255,255,0.4)';
  });
}

function setMatQuizMode(mode) {
  window._matQuizMode = mode;
  const stdBtn = document.getElementById('mat-mode-standard');
  const sitBtn = document.getElementById('mat-mode-situational');
  if (stdBtn && sitBtn) {
    if (mode === 'standard') {
      stdBtn.style.borderColor = 'rgba(102,126,234,0.7)';
      stdBtn.style.background  = 'rgba(102,126,234,0.2)';
      stdBtn.style.color       = '#a5b4fc';
      sitBtn.style.borderColor = 'rgba(255,255,255,0.12)';
      sitBtn.style.background  = 'rgba(255,255,255,0.04)';
      sitBtn.style.color       = 'rgba(255,255,255,0.4)';
    } else {
      sitBtn.style.borderColor = 'rgba(251,146,60,0.7)';
      sitBtn.style.background  = 'rgba(251,146,60,0.2)';
      sitBtn.style.color       = '#fdba74';
      stdBtn.style.borderColor = 'rgba(255,255,255,0.12)';
      stdBtn.style.background  = 'rgba(255,255,255,0.04)';
      stdBtn.style.color       = 'rgba(255,255,255,0.4)';
    }
  }
}

function regenMaterialQuiz() {
  // "Generate More" = append, not replace
  appendMaterialQuiz();
}

function mountMaterialExamPlayer(root, questions, difficulty, slides, quizMode) {
  if (!root || !questions || questions.length === 0) return;

  const diffColors = { easy:'#4ade80', medium:'#fbbf24', hard:'#f87171' };
  const diffColor  = diffColors[difficulty] || '#667eea';
  const diffLabel  = (difficulty || 'medium').charAt(0).toUpperCase() + (difficulty||'medium').slice(1);
  const total      = questions.length;
  const isSituational = (quizMode || '') === 'situational';

  let score = 0, answered = 0;
  const ts = Date.now();

  // Build HTML using the same classes as the chat exam mode
  let html = `
    <div class="exam-header" style="margin-bottom:20px;">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <span class="exam-badge">📝 Practice Quiz</span>
        <span style="display:inline-flex;align-items:center;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;
          background:${diffColor}22;border:1px solid ${diffColor}66;color:${diffColor};">
          ${diffLabel}
        </span>
        ${isSituational ? `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;background:rgba(251,146,60,0.15);border:1px solid rgba(251,146,60,0.4);color:#fdba74;">🎭 Situational</span>` : ''}
        <span style="font-size:12px;color:rgba(255,255,255,0.4);">${total} questions</span>
      </div>
      <span class="exam-count" id="matexam-score-${ts}">0 / ${total} correct</span>
    </div>
    <div id="matexam-list-${ts}">`;

  questions.forEach((q, idx) => {
    const qId = `meq-${ts}-${idx}`;
    html += `
      <div class="exam-question" id="${qId}">
        <div class="exam-q-num">Q${q.number || idx+1}</div>
        <div class="exam-q-text">${q.question}</div>
        <div class="exam-options">
          ${['A','B','C','D'].map(letter => {
            const opt = q.options[letter];
            if (!opt) return '';
            const ans = (q.answer||'').trim().charAt(0).toUpperCase();
            return `<button class="exam-option" data-letter="${letter}" data-qid="${qId}"
              data-answer="${ans}" data-examts="${ts}" onclick="handleMatExamAnswer(this)">
              ${letter}) ${opt}
            </button>`;
          }).join('')}
        </div>
        <div class="exam-explanation" id="${qId}-exp" style="display:none;">
          <strong>Answer: ${q.answer}</strong>${q.explanation ? ' — ' + q.explanation : ''}
        </div>
      </div>`;
  });

  html += `</div>
    <div id="matexam-result-${ts}" class="exam-result" style="display:none;margin-top:20px;"></div>`;

  root.innerHTML = html;

  // Store question count + ts on root for the answer handler
  root.dataset.examTs    = ts;
  root.dataset.examTotal = total;

  // Ensure master list is in sync (for append to work even when opened from library)
  if (!window._currentQuizQuestions || window._currentQuizQuestions.length !== total) {
    window._currentQuizQuestions = questions.slice();
  }
  // Sync used-question tracker
  if (!window._usedQuizQuestions) window._usedQuizQuestions = [];
  questions.forEach(q => {
    const t = (q.question || '').substring(0, 80);
    if (t && !window._usedQuizQuestions.includes(t)) window._usedQuizQuestions.push(t);
  });
}

function handleMatExamAnswer(btn) {
  const qId    = btn.dataset.qid;
  const chosen = btn.dataset.letter;
  const raw    = (btn.dataset.answer || '').trim();
  const correct= (raw.match(/^([A-D])/i)||['',''])[1].toUpperCase();
  if (!correct) return;
  const ts     = btn.dataset.examts;
  const qEl    = document.getElementById(qId);
  if (!qEl) return;

  // Disable all options in this question + highlight
  qEl.querySelectorAll('.exam-option').forEach(b => {
    b.disabled = true;
    if (b.dataset.letter === correct)               b.classList.add('exam-correct');
    else if (b.dataset.letter === chosen)           b.classList.add('exam-wrong');
    else                                            b.classList.add('exam-dimmed');
  });

  // Show explanation
  const expEl = document.getElementById(`${qId}-exp`);
  if (expEl) expEl.style.display = 'block';

  // Tally score
  const listEl  = document.getElementById(`matexam-list-${ts}`);
  if (!listEl) return;
  const allQs   = listEl.querySelectorAll('.exam-question');
  let   answeredQs = 0, correctQs = 0;
  allQs.forEach(el => {
    if (el.querySelectorAll('.exam-option[disabled]').length > 0) {
      answeredQs++;
      if (!el.querySelector('.exam-wrong')) correctQs++;
    }
  });

  const scoreEl = document.getElementById(`matexam-score-${ts}`);
  if (scoreEl) scoreEl.textContent = `${correctQs} / ${allQs.length} correct`;

  // Final result banner when all answered
  if (answeredQs === allQs.length) {
    const pct    = Math.round((correctQs / allQs.length) * 100);
    const grade  = pct >= 90 ? '🏆 Excellent!' : pct >= 70 ? '👍 Good job!' : pct >= 50 ? '📚 Keep studying!' : '💪 More practice needed';
    const rEl    = document.getElementById(`matexam-result-${ts}`);
    if (rEl) {
      rEl.style.display = 'block';
      rEl.className     = `exam-result ${pct >= 70 ? 'exam-result-pass' : 'exam-result-fail'}`;
      rEl.innerHTML     = `
        <div style="font-size:18px;font-weight:800;margin-bottom:6px;">${grade}</div>
        <div style="font-size:15px;">You scored <strong>${correctQs}/${allQs.length}</strong> (${pct}%)</div>
        <div style="display:flex;gap:10px;margin-top:14px;justify-content:center;flex-wrap:wrap;">
          <button onclick="startMaterialQuiz(window.currentSlides, document.getElementById('mat-exam-player'))" style="padding:9px 20px;background:linear-gradient(135deg,#667eea,#764ba2);border:none;border-radius:9px;color:white;font-size:13px;font-weight:700;cursor:pointer;">
            🔁 New Quiz
          </button>
          <button onclick="appendMaterialQuiz()" style="padding:9px 20px;background:rgba(102,126,234,0.2);border:1px solid rgba(102,126,234,0.4);border-radius:9px;color:#a5b4fc;font-size:13px;font-weight:700;cursor:pointer;">
            ➕ Add More Questions
          </button>
        </div>`;
      // Smooth scroll to result
      rEl.scrollIntoView({ behavior:'smooth', block:'center' });
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  MATERIAL FLASHCARD PLAYER (parse text + mount interactive cards)
// ═══════════════════════════════════════════════════════════════════════════

function parseMaterialFlashcards(text) {
  const cards = [];
  const blocks = text.split(/\n(?=CARD\s+\d+)/i).filter(b => b.trim());
  blocks.forEach(block => {
    let m = block.match(/CARD\s+\d+\s+Q:\s*([\s\S]+?)\s+A:\s*([\s\S]+)/i);
    if (!m) m = block.match(/Q:\s*([\s\S]+?)\nA:\s*([\s\S]+)/i);
    if (m) {
      const front = m[1].replace(/\s+A:.*$/i,'').trim();
      const back  = m[2].trim();
      if (front && back) cards.push({ front, back });
    }
  });
  return cards;
}

function mountMaterialFlashcardPlayer(root, flashcards, topic) {
  let currentCard = 0, correct = 0, incorrect = 0, streak = 0, maxStreak = 0;
  let isFlipped = false, knownCards = [], activeCards = [...flashcards];
  const ts = Date.now();

  function render() {
    if (currentCard >= activeCards.length) { showDone(); return; }
    const card = activeCards[currentCard];
    const pct  = Math.round((currentCard / activeCards.length) * 100);
    isFlipped  = false;

    root.innerHTML = `
      <div class="message-bubble flashcard-bubble" style="border-radius:16px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#667eea" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
          </svg>
          <strong style="font-size:16px;">Studying: ${topic}</strong>
        </div>
        <div class="flashcard-controls">
          <div class="flashcard-progress">
            <div class="progress-text"><span>Card ${currentCard+1} of ${activeCards.length}</span><span>${pct}%</span></div>
            <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
          </div>
          <div class="flashcard-stats">
            <div class="stat stat-correct">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
              ${correct}
            </div>
            <div class="stat stat-incorrect">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              ${incorrect}
            </div>
            <div class="stat stat-streak">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>
              ${streak}
            </div>
          </div>
        </div>
        <div class="mini-flashcards">
          <div class="mini-card" id="mfc-card-${ts}">
            <div class="mini-card-inner" id="mfc-inner-${ts}">
              <div class="mini-card-front">
                <div class="card-label">Question</div>
                <div class="card-content">${card.front}</div>
                <div class="card-hint">tap to reveal →</div>
              </div>
              <div class="mini-card-back">
                <div class="card-label">Answer</div>
                <div class="card-content">${card.back}</div>
              </div>
            </div>
          </div>
        </div>
        <div class="flashcard-actions" id="mfc-actions-${ts}">
          <button class="flashcard-btn btn-flip" id="mfc-flip-${ts}">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>
            Reveal Answer
          </button>
          <button class="flashcard-btn btn-know" id="mfc-know-${ts}" style="display:none;">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>
            I Know This
          </button>
          <button class="flashcard-btn btn-dont-know" id="mfc-nope-${ts}" style="display:none;">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>
            Need Review
          </button>
        </div>
      </div>`;

    setTimeout(() => {
      const cardEl=document.getElementById(`mfc-card-${ts}`);
      const flipBtn=document.getElementById(`mfc-flip-${ts}`);
      const knowBtn=document.getElementById(`mfc-know-${ts}`);
      const nopeBtn=document.getElementById(`mfc-nope-${ts}`);
      function doFlip(){
        isFlipped=!isFlipped;
        if(isFlipped){
          if(cardEl)cardEl.classList.add('flipped');
          if(knowBtn)knowBtn.style.display='flex';
          if(nopeBtn)nopeBtn.style.display='flex';
          if(flipBtn)flipBtn.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg> Flip Back';
        } else {
          if(cardEl)cardEl.classList.remove('flipped');
          if(knowBtn)knowBtn.style.display='none';
          if(nopeBtn)nopeBtn.style.display='none';
          if(flipBtn)flipBtn.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg> Reveal Answer';
        }
      }
      if(cardEl)cardEl.addEventListener('click',doFlip);
      if(flipBtn)flipBtn.addEventListener('click',doFlip);
      if(knowBtn)knowBtn.addEventListener('click',()=>{knownCards.push(activeCards[currentCard]);correct++;streak++;if(streak>maxStreak)maxStreak=streak;currentCard++;render();});
      if(nopeBtn)nopeBtn.addEventListener('click',()=>{incorrect++;streak=0;currentCard++;render();});
    },0);
  }

  function showDone() {
    const acc=activeCards.length>0?Math.round((correct/activeCards.length)*100):0;
    const msg=acc>=80?'🌟 Excellent! Mastered this set!':acc>=60?'👍 Good work! Review the missed ones.':'💪 Keep practicing!';
    root.innerHTML=`
      <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:32px;color:white;text-align:center;">
        <div class="flashcard-complete">
          <div class="complete-title">🎉 Session Complete!</div>
          <div class="complete-stats">
            <div class="complete-stat"><div class="complete-stat-value" style="color:#667eea;">${flashcards.length}</div><div class="complete-stat-label">Cards</div></div>
            <div class="complete-stat"><div class="complete-stat-value" style="color:#4ade80;">${correct}</div><div class="complete-stat-label">Correct</div></div>
            <div class="complete-stat"><div class="complete-stat-value" style="color:#f87171;">${incorrect}</div><div class="complete-stat-label">Review</div></div>
            <div class="complete-stat"><div class="complete-stat-value" style="color:#fbbf24;">${maxStreak}</div><div class="complete-stat-label">Streak</div></div>
            <div class="complete-stat"><div class="complete-stat-value" style="color:#a78bfa;">${acc}%</div><div class="complete-stat-label">Accuracy</div></div>
          </div>
          <p style="color:rgba(255,255,255,0.6);margin:16px 0 24px;">${msg}</p>
          <div style="display:flex;gap:10px;justify-content:center;">
            <button id="fc-restart" class="flashcard-btn btn-flip" style="font-size:13px;">🔁 Restart</button>
            ${incorrect>0?'<button id="fc-retry" class="flashcard-btn btn-dont-know" style="font-size:13px;">Retry Wrong ('+incorrect+')</button>':''}
          </div>
        </div>
      </div>`;
    setTimeout(()=>{
      const rb=document.getElementById('fc-restart');
      if(rb)rb.onclick=()=>{activeCards=[...flashcards];currentCard=0;correct=0;incorrect=0;streak=0;maxStreak=0;knownCards=[];render();};
      const rt=document.getElementById('fc-retry');
      if(rt)rt.onclick=()=>{activeCards=flashcards.filter(c=>!knownCards.includes(c));if(!activeCards.length)activeCards=[...flashcards];currentCard=0;correct=0;incorrect=0;streak=0;render();};
    },0);
  }

  render();
}

function toggleDownloadMenu(e) {
  e.stopPropagation();
  const menu = document.getElementById('download-menu');
  if (!menu) return;
  const isOpen = menu.style.display !== 'none';
  menu.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) {
    setTimeout(() => document.addEventListener('click', closeDownloadMenu, { once: true }), 10);
  }
}

function closeDownloadMenu() {
  const menu = document.getElementById('download-menu');
  if (menu) menu.style.display = 'none';
}

function downloadMaterialsAsText() {
  const modal = document.getElementById('materials-display-modal');
  const docTitle = (modal && document.getElementById('doc-title-display')?.textContent) || 'Study Material';
  const activePage = Array.from(document.querySelectorAll('.doc-page-wrap')).find(el => el.style.display !== 'none' && el.style.display !== '');
  const paper = activePage ? activePage.querySelector('[contenteditable]') : null;
  if (!paper) { _showToast('⚠️ Nothing to download on this tab.'); return; }
  const text = paper.innerText || paper.textContent || '';
  const blob = new Blob([docTitle + '\n' + new Date().toLocaleDateString() + '\n\n' + text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = docTitle.replace(/[^a-z0-9]/gi,'_') + '.txt';
  a.click(); URL.revokeObjectURL(url);
}

function downloadMaterialsAsHTML() {
  const modal = document.getElementById('materials-display-modal');
  const docTitle = (modal && document.getElementById('doc-title-display')?.textContent) || 'Study Material';
  const activePage = Array.from(document.querySelectorAll('.doc-page-wrap')).find(el => el.style.display !== 'none' && el.style.display !== '');
  const paper = activePage ? activePage.querySelector('[contenteditable]') : null;
  const bodyHTML = paper ? paper.innerHTML : '<p>No content</p>';
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${docTitle}</title>
<style>body{font-family:'Segoe UI',Arial,sans-serif;padding:48px 56px;color:#1a1a1a;line-height:1.75;max-width:780px;margin:0 auto;}h1,h2{border-bottom:2px solid #e2e8f0;padding-bottom:6px;}ul,ol{padding-left:24px;}li{margin-bottom:6px;}</style>
</head><body>
<h1 style="text-align:center;border:none;font-size:20px;color:#64748b;">${docTitle}</h1>
<p style="text-align:center;font-size:12px;color:#94a3b8;margin-bottom:32px;">${new Date().toLocaleDateString()}</p>
${bodyHTML}</body></html>`;
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = docTitle.replace(/[^a-z0-9]/gi,'_') + '.html';
  a.click(); URL.revokeObjectURL(url);
}

function downloadMaterials() {
  // Find the currently visible tab page
  const activePage = Array.from(document.querySelectorAll('.doc-page-wrap'))
    .find(el => el.style.display !== 'none' && el.style.display !== '');

  const modal = document.getElementById('materials-display-modal');
  const docTitle = (modal && document.getElementById('doc-title-display')?.textContent) || 'Study Material';

  // If it's the quiz tab — build a printable version from the exam player
  const examPlayer = document.getElementById('mat-exam-player');
  if (activePage && activePage.id === 'docpage-quiz' && examPlayer) {
    const printWin = window.open('', '', 'width=860,height=1000');
    printWin.document.write(`
      <html><head>
        <title>${docTitle} — Practice Quiz</title>
        <style>
          body { font-family: 'Segoe UI', Arial, sans-serif; padding: 32px 48px; color: #1a1a1a; line-height: 1.6; }
          h1 { font-size: 22px; color: #0f172a; margin-bottom: 6px; }
          .subtitle { font-size: 13px; color: #64748b; margin-bottom: 28px; }
          .question { border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px 20px; margin-bottom: 18px; page-break-inside: avoid; }
          .q-num { font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
          .q-text { font-size: 14px; font-weight: 600; color: #0f172a; margin-bottom: 12px; }
          .option { padding: 8px 12px; border-radius: 7px; font-size: 13px; color: #334155; margin-bottom: 6px; border: 1px solid #e2e8f0; }
          .option.correct { background: #dcfce7; border-color: #86efac; color: #166534; font-weight: 700; }
          .explanation { margin-top: 12px; padding: 10px 14px; background: #f0f9ff; border-left: 3px solid #38bdf8; font-size: 12.5px; color: #0c4a6e; border-radius: 0 6px 6px 0; }
          @media print { @page { margin: 0.75in; } body { padding: 0; } }
        </style>
      </head><body>
        <h1>📝 ${docTitle} — Practice Quiz</h1>
        <div class="subtitle">Generated by Chunks AI · ${new Date().toLocaleDateString('en-PH', {year:'numeric',month:'long',day:'numeric'})}</div>
        ${Array.from(examPlayer.querySelectorAll('.exam-question')).map((qEl, idx) => {
          const qNum  = qEl.querySelector('.exam-q-num')?.textContent  || `Q${idx+1}`;
          const qText = qEl.querySelector('.exam-q-text')?.textContent || '';
          const opts  = Array.from(qEl.querySelectorAll('.exam-option')).map(btn => {
            const isCorrect = btn.classList.contains('exam-correct') || btn.dataset.letter === (btn.dataset.answer||'').trim().charAt(0).toUpperCase();
            return `<div class="option${isCorrect?' correct':''}">${btn.textContent.trim()}</div>`;
          }).join('');
          const expEl = qEl.querySelector('.exam-explanation');
          const exp   = expEl ? `<div class="explanation"><strong>Explanation:</strong> ${expEl.textContent.replace(/^Answer:[A-D]\s*—?\s*/,'').trim()}</div>` : '';
          return `<div class="question"><div class="q-num">${qNum}</div><div class="q-text">${qText}</div>${opts}${exp}</div>`;
        }).join('')}
      </body></html>`);
    printWin.document.close();
    printWin.focus();
    setTimeout(() => { printWin.print(); printWin.close(); }, 400);
    return;
  }

  // For all other tabs — get the contenteditable editor content
  const paper = activePage ? activePage.querySelector('[contenteditable]') : null;
  if (!paper) {
    // Fallback: try visible material-content
    const vis = Array.from(document.querySelectorAll('.material-content')).find(el => el.style.display === 'block');
    if (!vis) { _showToast('⚠️ Nothing to export on this tab.'); return; }
  }

  const bodyHTML = paper ? paper.innerHTML : '';
  const printWin = window.open('', '', 'width=860,height=1000');
  printWin.document.write(`
    <html><head>
      <title>${docTitle}</title>
      <script>
        MathJax = { tex: { inlineMath: [['$','$'],['\\\\(','\\\\)']], displayMath: [['$$','$$'],['\\\\[','\\\\]']] } };
      <\/script>
      <script src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js"><\/script>
      <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; padding: 48px 56px; color: #1a1a1a; line-height: 1.75; max-width: 780px; margin: 0 auto; }
        h1 { color: #0f172a; font-size: 24px; border-bottom: 3px solid #e2e8f0; padding-bottom: 8px; margin-top: 32px; }
        h2 { color: #1e293b; font-size: 18px; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px; margin-top: 24px; }
        h3 { color: #334155; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 18px; }
        ul, ol { padding-left: 24px; margin: 10px 0; }
        li { margin-bottom: 6px; }
        strong { background: linear-gradient(120deg,#fff176,#fff9c4); padding: 1px 4px; border-radius: 3px; }
        @media print { @page { margin: 0.85in; } body { padding: 0; } }
      </style>
    </head>
    <body>
      <h1 style="text-align:center;border:none;font-size:20px;color:#64748b;font-weight:600;margin-bottom:4px;">${docTitle}</h1>
      <p style="text-align:center;font-size:12px;color:#94a3b8;margin-bottom:32px;">${new Date().toLocaleDateString('en-PH',{year:'numeric',month:'long',day:'numeric'})}</p>
      ${bodyHTML}
    </body></html>`);
  printWin.document.close();
  printWin.focus();
  setTimeout(() => { printWin.print(); printWin.close(); }, 500);
}
  
// Helper functions
function closeMaterialGenerator() {
  const modal = document.getElementById('material-generator-modal');
  if (modal) modal.remove();
}


// ============================================================
// SAVED MATERIALS LIBRARY
// ============================================================

const MAT_ICONS = {
  notes: {
    color: '#63b3ed',
    bg: 'rgba(99,179,237,0.12)',
    border: 'rgba(99,179,237,0.2)',
    label: 'Study Notes',
    svg: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/></svg>'
  },
  reviewer: {
    color: '#fc814a',
    bg: 'rgba(252,129,74,0.12)',
    border: 'rgba(252,129,74,0.2)',
    label: 'Exam Reviewer',
    svg: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>'
  },
  flashcards: {
    color: '#9a75ea',
    bg: 'rgba(154,117,234,0.12)',
    border: 'rgba(154,117,234,0.2)',
    label: 'Flashcards',
    svg: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>'
  },
  summary: {
    color: '#48bb78',
    bg: 'rgba(72,187,120,0.12)',
    border: 'rgba(72,187,120,0.2)',
    label: 'Summary Sheet',
    svg: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg>'
  },
  quiz: {
    color: '#ed8936',
    bg: 'rgba(237,137,54,0.12)',
    border: 'rgba(237,137,54,0.2)',
    label: 'Practice Quiz',
    svg: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>'
  },
  all: {
    color: '#a78bfa',
    bg: 'rgba(167,139,250,0.12)',
    border: 'rgba(167,139,250,0.2)',
    label: 'All Materials',
    svg: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>'
  }
};

function getSavedMaterials() {
  try { return JSON.parse(localStorage.getItem('chunks_saved_materials') || '[]'); }
  catch(e) { return []; }
}

function saveMaterialToLibrary(materials, type, filename) {
  const saved = getSavedMaterials();
  const entry = {
    id: Date.now().toString(),
    type,
    filename: filename.replace(/\.[^.]+$/, ''), // strip extension
    materials,
    createdAt: new Date().toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
  };
  // For 'all', store once; for specific types keep per type per file
  // Deduplicate: if same filename+type exists, replace it
  const idx = saved.findIndex(s => s.filename === entry.filename && s.type === type);
  if (idx >= 0) saved[idx] = entry;
  else saved.unshift(entry); // newest first
  // Keep max 50
  if (saved.length > 50) saved.splice(50);
  localStorage.setItem('chunks_saved_materials', JSON.stringify(saved));
  renderSavedMaterialsSidebar();
}

function deleteSavedMaterial(id) {
  const saved = getSavedMaterials().filter(s => s.id !== id);
  localStorage.setItem('chunks_saved_materials', JSON.stringify(saved));
  renderSavedMaterialsSidebar();
}

function clearAllSavedMaterials() {
  if (!confirm('Delete all saved materials?')) return;
  localStorage.removeItem('chunks_saved_materials');
  renderSavedMaterialsSidebar();
}

function openSavedMaterial(id) {
  const saved = getSavedMaterials();
  const entry = saved.find(s => s.id === id);
  if (!entry) return;
  // For quiz entries, restore parsed questions and difficulty
  if (entry.type === 'quiz' && entry.materials._parsedQuestions) {
    try {
      const parsedQuestions = JSON.parse(entry.materials._parsedQuestions);
      const difficulty = entry.materials._difficulty || 'medium';
      const quizMode   = entry.materials._quizMode   || 'standard';
      displayGeneratedMaterials(entry.materials, entry.type, entry.filename, parsedQuestions, difficulty, quizMode);
    } catch(e) {
      displayGeneratedMaterials(entry.materials, entry.type, entry.filename);
    }
  } else {
    displayGeneratedMaterials(entry.materials, entry.type, entry.filename);
  }
}

function renameSavedMaterial(materials, type, newTitle) {
  const saved = getSavedMaterials();
  // Find by matching type and content fingerprint (first 30 chars of first value)
  const fp = Object.values(materials)[0]?.substring(0, 30) || '';
  const idx = saved.findIndex(s => s.type === type && (Object.values(s.materials)[0]||'').substring(0,30) === fp);
  if (idx >= 0) {
    saved[idx].filename = newTitle;
    localStorage.setItem('chunks_saved_materials', JSON.stringify(saved));
    renderSavedMaterialsSidebar();
  }
}

function renderSavedMaterialsSidebar() {
  const list = document.getElementById('saved-materials-list');
  const clearBtn = document.getElementById('clear-materials-btn');
  const noMsg = document.getElementById('no-materials-msg');
  if (!list) return;

  const saved = getSavedMaterials();

  if (clearBtn) clearBtn.style.display = saved.length > 0 ? 'block' : 'none';

  // Remove existing cards (keep the no-msg element)
  Array.from(list.children).forEach(el => {
    if (el.id !== 'no-materials-msg') el.remove();
  });

  if (saved.length === 0) {
    if (noMsg) noMsg.style.display = 'block';
    return;
  }
  if (noMsg) noMsg.style.display = 'none';

  saved.forEach(entry => {
    const meta = MAT_ICONS[entry.type] || MAT_ICONS.notes;
    const card = document.createElement('div');
    card.id = `saved-mat-${entry.id}`;
    card.style.cssText = `
      display:flex;align-items:center;gap:9px;padding:9px 10px;
      background:${meta.bg};border:1px solid ${meta.border};
      border-radius:10px;cursor:pointer;transition:all 0.18s;
      position:relative;
    `;
    card.onmouseenter = () => { card.style.background = meta.bg.replace('0.12','0.2'); card.style.transform = 'translateX(2px)'; };
    card.onmouseleave = () => { card.style.background = meta.bg; card.style.transform = 'none'; };

    card.innerHTML = `
      <!-- Icon pill -->
      <div style="width:30px;height:30px;border-radius:8px;background:${meta.bg};border:1px solid ${meta.border};display:flex;align-items:center;justify-content:center;flex-shrink:0;color:${meta.color};">
        ${meta.svg}
      </div>
      <!-- Text -->
      <div style="flex:1;min-width:0;">
        <div style="font-size:11.5px;font-weight:700;color:white;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${entry.filename}</div>
        <div style="font-size:10px;color:${meta.color};font-weight:600;margin-top:1px;">
          ${entry.type === 'quiz' && entry.materials && entry.materials._questionCount
            ? entry.materials._questionCount + ' questions · ' + entry.createdAt
            : meta.label + ' · ' + entry.createdAt}
        </div>
      </div>
      <!-- Delete btn -->
      <button onclick="event.stopPropagation();deleteSavedMaterial('${entry.id}')" style="background:none;border:none;color:rgba(255,255,255,0.18);cursor:pointer;padding:3px;border-radius:5px;display:flex;align-items:center;transition:all 0.15s;flex-shrink:0;" onmouseenter="this.style.color='#f87171'" onmouseleave="this.style.color='rgba(255,255,255,0.18)'">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
      </button>
    `;
    card.addEventListener('click', () => openSavedMaterial(entry.id));
    list.appendChild(card);
  });
}

// Init on load
document.addEventListener('DOMContentLoaded', () => {
  renderSavedMaterialsSidebar();
});
// Also try immediate render (if DOM already ready)
if (document.readyState !== 'loading') {
  setTimeout(renderSavedMaterialsSidebar, 300);
}

function closeMaterialsDisplay() {
  const modal = document.getElementById('materials-display-modal');
  if (modal) modal.remove();
  renderSavedMaterialsSidebar();
}

function showLoadingModal(title, message) {
  const modal = document.createElement('div');
  modal.id = 'loading-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0,0,0,0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10001;
  `;
  
  modal.innerHTML = `
    <div style="
      background: #1a1a1a;
      padding: 40px;
      border-radius: 16px;
      text-align: center;
      max-width: 400px;
    ">
      <div style="
        width: 60px;
        height: 60px;
        border: 4px solid rgba(102, 126, 234, 0.2);
        border-top-color: #667eea;
        border-radius: 50%;
        margin: 0 auto 24px;
        animation: spin 1s linear infinite;
      "></div>
      <h3 style="color: white; margin-bottom: 8px;">${title}</h3>
      <p style="color: #aaa;">${message}</p>
    </div>
  `;
  
  document.body.appendChild(modal);
}

function hideLoadingModal() {
  const modal = document.getElementById('loading-modal');
  if (modal) modal.remove();
}
// ==========================================
// ==========================================
// HEALTH REMINDER SYSTEM — redesigned
// ==========================================
try {
  let healthReminderTime   = 0;
  let healthReminderInterval = 180; // 180 × 10s ticks = 30 minutes
  let lastReminderIndex    = -1;

  /* ── SVG icon builders ── */
  const SVG = {
    droplet: `<svg viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>`,
    glass:   `<svg viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2h8l1 10H7L8 2z"/><path d="M7 12c0 5 10 5 10 0"/><line x1="9" y1="2" x2="8" y2="7"/></svg>`,
    brain:   `<svg viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/></svg>`,
    stretch: `<svg viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2a2 2 0 0 1 2 2"/><path d="M12 22V12"/><path d="m9 9 3-3 3 3"/><path d="M5 12h14"/></svg>`,
    legs:    `<svg viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v20"/><path d="M16 2v20"/><path d="M8 12h8"/></svg>`,
    shoulders:`<svg viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12h20"/><path d="m12 2 5 5-5 5-5-5 5-5z"/></svg>`,
    eye:     `<svg viewBox="0 0 24 24" fill="none" stroke="#fb923c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>`,
    eyeOff:  `<svg viewBox="0 0 24 24" fill="none" stroke="#fb923c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`,
    mountain:`<svg viewBox="0 0 24 24" fill="none" stroke="#fb923c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8 3 4 8 5-5 5 15H2L8 3z"/></svg>`,
    walk:    `<svg viewBox="0 0 24 24" fill="none" stroke="#f472b6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="4" r="2"/><path d="M9 20l1-5 3 3 1-8"/><path d="m6 8 6-1 4 4"/><path d="m6 12 4 8"/></svg>`,
    wind:    `<svg viewBox="0 0 24 24" fill="none" stroke="#f472b6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2"/><path d="M9.6 4.6A2 2 0 1 1 11 8H2"/><path d="M12.6 19.4A2 2 0 1 0 14 16H2"/></svg>`,
    leaf:    `<svg viewBox="0 0 24 24" fill="none" stroke="#f472b6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/></svg>`,
    music:   `<svg viewBox="0 0 24 24" fill="none" stroke="#818cf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`,
    breathe: `<svg viewBox="0 0 24 24" fill="none" stroke="#818cf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22V12"/><path d="M12 12C12 6 6 6 6 6s0 6 6 6z"/><path d="M12 12c0-6 6-6 6-6s0 6-6 6z"/></svg>`,
    moon:    `<svg viewBox="0 0 24 24" fill="none" stroke="#818cf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`,
    apple:   `<svg viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0 3 3"/><path d="M17 6H7a5 5 0 0 0-5 5v5a5 5 0 0 0 5 5h10a5 5 0 0 0 5-5v-5a5 5 0 0 0-5-5z"/></svg>`,
    nut:     `<svg viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z"/><path d="M12 8v8"/><path d="M8 12h8"/></svg>`,
    posture: `<svg viewBox="0 0 24 24" fill="none" stroke="#facc15" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="2"/><path d="M10 10h4l1 9H9l1-9z"/><path d="M9 14H7"/><path d="M15 14h2"/></svg>`,
    spine:   `<svg viewBox="0 0 24 24" fill="none" stroke="#facc15" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="2" x2="12" y2="22"/><path d="M9 6h6M8 10h8M9 14h6M10 18h4"/></svg>`,
    chair:   `<svg viewBox="0 0 24 24" fill="none" stroke="#facc15" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v3"/><path d="M2 11v5a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v2H6v-2a2 2 0 0 0-4 0z"/><path d="M4 18v2M20 18v2"/></svg>`,
  };

  /* accent colours per reminder type */
  const THEMES = {
    water:   { accent: 'linear-gradient(90deg,#38bdf8,#818cf8)', iconBg: 'rgba(56,189,248,0.12)', iconBorder: 'rgba(56,189,248,0.2)',  btn: 'linear-gradient(135deg,#38bdf8,#6366f1)', glow: 'rgba(56,189,248,0.3)',  tipBg: 'rgba(56,189,248,0.1)'  },
    stretch: { accent: 'linear-gradient(90deg,#34d399,#059669)', iconBg: 'rgba(52,211,153,0.12)', iconBorder: 'rgba(52,211,153,0.2)',  btn: 'linear-gradient(135deg,#34d399,#059669)', glow: 'rgba(52,211,153,0.3)',  tipBg: 'rgba(52,211,153,0.1)'  },
    eyes:    { accent: 'linear-gradient(90deg,#fb923c,#f97316)', iconBg: 'rgba(251,146,60,0.12)',  iconBorder: 'rgba(251,146,60,0.2)',  btn: 'linear-gradient(135deg,#fb923c,#ef4444)', glow: 'rgba(251,146,60,0.3)',  tipBg: 'rgba(251,146,60,0.1)'  },
    walk:    { accent: 'linear-gradient(90deg,#f472b6,#ec4899)', iconBg: 'rgba(244,114,182,0.12)', iconBorder: 'rgba(244,114,182,0.2)', btn: 'linear-gradient(135deg,#f472b6,#8b5cf6)', glow: 'rgba(244,114,182,0.3)', tipBg: 'rgba(244,114,182,0.1)' },
    brain:   { accent: 'linear-gradient(90deg,#818cf8,#a78bfa)', iconBg: 'rgba(129,140,248,0.12)', iconBorder: 'rgba(129,140,248,0.2)', btn: 'linear-gradient(135deg,#818cf8,#764ba2)', glow: 'rgba(129,140,248,0.3)', tipBg: 'rgba(129,140,248,0.1)' },
    snack:   { accent: 'linear-gradient(90deg,#4ade80,#22c55e)', iconBg: 'rgba(74,222,128,0.12)',  iconBorder: 'rgba(74,222,128,0.2)',  btn: 'linear-gradient(135deg,#4ade80,#059669)', glow: 'rgba(74,222,128,0.3)',  tipBg: 'rgba(74,222,128,0.1)'  },
    posture: { accent: 'linear-gradient(90deg,#facc15,#f59e0b)', iconBg: 'rgba(250,204,21,0.12)',  iconBorder: 'rgba(250,204,21,0.2)',  btn: 'linear-gradient(135deg,#facc15,#f59e0b)', glow: 'rgba(250,204,21,0.3)',  tipBg: 'rgba(250,204,21,0.1)'  },
  };

  const healthReminders = [
    {
      type: 'water',
      iconSvg: SVG.droplet,
      title: 'Stay Hydrated',
      message: 'Your brain is 75% water — keep it sharp.',
      tips: [
        { svg: SVG.droplet,  color: '#38bdf8', text: 'Drink a full glass of water now' },
        { svg: SVG.glass,    color: '#38bdf8', text: 'Aim for 8 glasses throughout the day' },
        { svg: SVG.brain,    color: '#a78bfa', text: 'Hydration improves memory & focus' },
      ]
    },
    {
      type: 'stretch',
      iconSvg: SVG.stretch,
      title: 'Time to Stretch',
      message: 'Loosen up — your muscles will thank you.',
      tips: [
        { svg: SVG.stretch,   color: '#34d399', text: 'Roll your neck slowly side to side' },
        { svg: SVG.shoulders, color: '#34d399', text: 'Roll your shoulders 5× each way' },
        { svg: SVG.legs,      color: '#34d399', text: 'Stand up and stretch your legs' },
      ]
    },
    {
      type: 'eyes',
      iconSvg: SVG.eye,
      title: 'Rest Your Eyes',
      message: 'Follow the 20-20-20 rule right now.',
      tips: [
        { svg: SVG.eyeOff,  color: '#fb923c', text: 'Close your eyes for 20 seconds' },
        { svg: SVG.mountain,color: '#fb923c', text: 'Look at something 20 feet away' },
        { svg: SVG.eye,     color: '#fb923c', text: 'Blink slowly to rehydrate eyes' },
      ]
    },
    {
      type: 'walk',
      iconSvg: SVG.walk,
      title: 'Quick Walk Break',
      message: 'Even 5 minutes of movement boosts focus.',
      tips: [
        { svg: SVG.walk, color: '#f472b6', text: 'Walk around for 3–5 minutes' },
        { svg: SVG.wind, color: '#f472b6', text: 'Open a window for fresh air' },
        { svg: SVG.leaf, color: '#f472b6', text: 'Step outside if you can' },
      ]
    },
    {
      type: 'brain',
      iconSvg: SVG.brain,
      title: 'Mind Reset',
      message: 'A brief pause helps consolidate memory.',
      tips: [
        { svg: SVG.breathe, color: '#818cf8', text: 'Breathe in 4s · hold 4s · out 4s' },
        { svg: SVG.music,   color: '#818cf8', text: 'Listen to calming music briefly' },
        { svg: SVG.moon,    color: '#818cf8', text: 'Close your eyes and do nothing' },
      ]
    },
    {
      type: 'snack',
      iconSvg: SVG.apple,
      title: 'Fuel Your Brain',
      message: 'A healthy snack keeps energy levels steady.',
      tips: [
        { svg: SVG.apple, color: '#4ade80', text: 'Grab a piece of fruit' },
        { svg: SVG.nut,   color: '#4ade80', text: 'A handful of nuts boosts focus' },
        { svg: SVG.glass, color: '#38bdf8', text: 'Avoid sugary drinks — stick to water' },
      ]
    },
    {
      type: 'posture',
      iconSvg: SVG.posture,
      title: 'Posture Check',
      message: 'Good posture keeps you energised longer.',
      tips: [
        { svg: SVG.posture, color: '#facc15', text: 'Sit up straight, feet flat on floor' },
        { svg: SVG.spine,   color: '#facc15', text: 'Relax your shoulders — drop them down' },
        { svg: SVG.chair,   color: '#facc15', text: 'Screen should be at eye level' },
      ]
    },
  ];

  function getRandomReminder() {
    let index;
    do {
      index = Math.floor(Math.random() * healthReminders.length);
    } while (index === lastReminderIndex && healthReminders.length > 1);
    lastReminderIndex = index;
    return healthReminders[index];
  }

  function showHealthReminder() {
    // Don't stack multiple reminders
    if (document.getElementById('health-reminder-overlay')) return;

    const reminder = getRandomReminder();
    const theme    = THEMES[reminder.type];

    // Build tips HTML with SVG icons
    const tipsHTML = reminder.tips.map(tip => `
      <div class="health-tip-item">
        <span class="health-tip-icon" style="background:${theme.tipBg};">
          ${tip.svg}
        </span>
        <span class="health-tip-text">${tip.text}</span>
      </div>
    `).join('');

    const overlay = document.createElement('div');
    overlay.className = 'health-reminder-overlay';
    overlay.id = 'health-reminder-overlay';

    overlay.innerHTML = `
      <div class="health-reminder-modal" style="
        --hr-accent: ${theme.accent};
        --hr-icon-bg: ${theme.iconBg};
        --hr-icon-border: ${theme.iconBorder};
        --hr-btn: ${theme.btn};
        --hr-btn-glow: ${theme.glow};
        --hr-tip-icon-bg: ${theme.tipBg};
      ">
        <div class="health-reminder-icon">
          ${reminder.iconSvg}
        </div>

        <div class="health-reminder-time">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          ${Math.round(healthReminderTime / 6)} min study session
        </div>

        <div class="health-reminder-title">${reminder.title}</div>
        <div class="health-reminder-message">${reminder.message}</div>

        <div class="health-reminder-tips">
          <div class="health-reminder-tips-title">Quick tips</div>
          ${tipsHTML}
        </div>

        <button class="health-reminder-button" onclick="dismissHealthReminder()">
          Got it — back to studying
        </button>
      </div>
    `;

    document.body.appendChild(overlay);
  }

  window.dismissHealthReminder = function() {
    const overlay = document.getElementById('health-reminder-overlay');
    if (overlay) {
      overlay.style.animation = 'hrFadeOut 0.25s ease forwards';
      setTimeout(() => overlay.remove(), 260);
    }
    healthReminderTime = 0;
  };

  // Check every 10 seconds; fire at 1-minute intervals (6 ticks = 1 min)
  setInterval(() => {
    if (!document.hidden) {
      healthReminderTime++;
      if (healthReminderTime > 0 && healthReminderTime % healthReminderInterval === 0) {
        showHealthReminder();
      }
    }
  }, 10000); // 10 seconds per tick → 6 ticks = 1 minute
} catch (error) {
  console.error('❌ Health reminder error:', error);

  // Health reminders disabled, but chat will still work
}

// CHUNKS SIDEBAR TAB SWITCHING
let currentChunksTab = 'chats';

function switchChunksTab(tabName) {
  currentChunksTab = tabName;
  
  document.querySelectorAll('.chunks-tab-btn').forEach(btn => {
    btn.classList.remove('active');
    if (btn.getAttribute('data-tab') === tabName) {
      btn.classList.add('active');
    }
  });
  
  document.querySelectorAll('.chunks-tab-panel').forEach(panel => {
    panel.classList.remove('active');
  });
  document.getElementById(`panel-${tabName}`).classList.add('active');
  
  if (tabName === 'chats') {
    displayChatHistory();
  } else if (tabName === 'contents') {
    renderChunksContents();
  } else if (tabName === 'books') {
    renderChunksBooks();
  } else if (tabName === 'progress') {
    renderSidebarProgress();
  }

  // FIX 6: Persist tab in sessionStorage so refresh restores same tab
  try { sessionStorage.setItem('chunks_active_tab', tabName); } catch(e) {}
}

// FIX 6: Restore active tab after page load
function restoreActiveTab() {
  try {
    const saved = sessionStorage.getItem('chunks_active_tab');
    if (saved && saved !== 'chats') {
      switchChunksTab(saved);
    }
  } catch(e) {}
}

function renderChunksContents() {
  const contentList = document.getElementById('chunks-content-list');
  
  if (!pdfDoc || outlineData.length === 0) {
    contentList.innerHTML = `
      <div class="chat-history-empty">
        <div class="chunks-empty-icon"><svg class="icon" width="18" height="18"><use href="#icon-document"/></svg></div>
        <div class="chunks-empty-text">Select a book to see contents</div>
      </div>
    `;
    return;
  }
  
  contentList.innerHTML = outlineData.map(item => `
    <div class="chunks-content-item" onclick="jumpToPage(${item.page}); if(window.innerWidth < 768) toggleChatHistory();">
      <div class="chunks-content-title">${escapeHtml(item.title)}</div>
      <div class="chunks-content-page">Page ${item.page}</div>
    </div>
  `).join('');
}

// ==========================================
// PERSISTENT BOOK TRACKING
// ==========================================

const BOOK_COVER_COLORS = [
  {bg:'rgba(99,102,241,0.18)', stroke:'#818cf8'},
  {bg:'rgba(168,85,247,0.18)', stroke:'#c084fc'},
  {bg:'rgba(236,72,153,0.16)', stroke:'#f472b6'},
  {bg:'rgba(20,184,166,0.16)', stroke:'#2dd4bf'},
  {bg:'rgba(245,158,11,0.16)', stroke:'#fbbf24'},
  {bg:'rgba(59,130,246,0.18)', stroke:'#60a5fa'},
  {bg:'rgba(16,185,129,0.16)', stroke:'#34d399'},
  {bg:'rgba(239,68,68,0.15)',  stroke:'#f87171'},
];

// Lucide-style book SVG icon
function _bookIcon(stroke) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>`;
}

function getBookCoverStyle(bookId) {
  const keys = Object.keys(bookLibrary || {});
  const idx = keys.indexOf(bookId);
  const i = idx >= 0 ? idx % BOOK_COVER_COLORS.length : (bookId.charCodeAt(0) % BOOK_COVER_COLORS.length);
  return BOOK_COVER_COLORS[i];
}

function getSavedBooks() {
  try {
    return JSON.parse(localStorage.getItem('chunks_opened_books') || '[]');
  } catch { return []; }
}

function saveBookToHistory(bookId, bookName, author, pages) {
  const books = getSavedBooks();
  // Remove existing entry if present, push to front
  const filtered = books.filter(b => b.id !== bookId);
  filtered.unshift({ id: bookId, name: bookName, author: author || '', pages: pages || null, lastOpened: new Date().toISOString() });
  // Keep max 20 books
  localStorage.setItem('chunks_opened_books', JSON.stringify(filtered.slice(0, 20)));
}

function renderChunksBooks() {
  const booksList = document.getElementById('chunks-books-list');
  if (!booksList) return;

  // Update current book page count if open
  const currentBookId = localStorage.getItem('eightysix_current_book');
  if (currentBookId && pdfDoc) {
    const books = getSavedBooks();
    const entry = books.find(b => b.id === currentBookId);
    if (entry) {
      entry.pages = pdfDoc.numPages;
      localStorage.setItem('chunks_opened_books', JSON.stringify(books));
    }
  }

  const books = getSavedBooks();

  if (books.length === 0) {
    booksList.innerHTML = `
      <div class="chat-history-empty">
        <div class="chunks-empty-icon" style="margin-bottom:10px;opacity:0.2;">
          <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>
        </div>
        <div class="chunks-empty-text">No books opened yet</div>
        <button class="chunks-upload-btn" onclick="openLibraryModal()" style="margin-top:12px;">Browse Library</button>
      </div>
    `;
    return;
  }

  booksList.innerHTML = books.map(book => {
    const isActive = book.id === currentBookId;
    const clr = getBookCoverStyle(book.id);
    const pageText = book.pages ? `${book.pages} pages` : 'Tap to open';
    const timeAgo = book.lastOpened ? getTimeAgo(new Date(book.lastOpened)) : '';
    return `
      <div class="chunks-book-card ${isActive ? 'active' : ''}" onclick="selectBook('${book.id}')" title="${book.name}" style="position:relative;">
        <div class="chunks-book-cover" style="background:${clr.bg};">${_bookIcon(clr.stroke)}</div>
        <div class="chunks-book-info">
          <div class="chunks-book-title">${book.name}</div>
          <div class="chunks-book-author">${book.author || ''}</div>
          <div class="chunks-book-meta">
            ${isActive ? '<span class="chunks-book-badge">Open</span>' : ''}
            <span>${isActive ? pageText : (timeAgo || pageText)}</span>
          </div>
        </div>
        <button onclick="event.stopPropagation();deleteBookFromSidebar('${book.id}','${book.name.replace(/'/g,"\\'")}' )" title="Remove book" style="position:absolute;top:7px;right:7px;width:24px;height:24px;border-radius:6px;background:transparent;border:none;color:rgba(255,255,255,0.2);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.15s;opacity:0;" class="book-delete-btn"
          onmouseenter="this.style.background='rgba(248,113,113,0.18)';this.style.color='#f87171';this.style.opacity='1'"
          onmouseleave="this.style.background='transparent';this.style.color='rgba(255,255,255,0.2)';this.style.opacity='0'">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
        </button>
      </div>
    `;
  }).join('');
  // Show delete buttons on hover of card
  booksList.querySelectorAll('.chunks-book-card').forEach(card => {
    card.addEventListener('mouseenter', () => { const b = card.querySelector('.book-delete-btn'); if(b) b.style.opacity='1'; });
    card.addEventListener('mouseleave', () => { const b = card.querySelector('.book-delete-btn'); if(b) b.style.opacity='0'; });
  });
}

function deleteBookFromSidebar(bookId, bookName) {
  showDCM().then(confirmed => {
    if (!confirmed) return;
    try {
      let books = JSON.parse(localStorage.getItem('chunks_open_books') || '[]');
      books = books.filter(b => b.id !== bookId);
      localStorage.setItem('chunks_open_books', JSON.stringify(books));
    } catch(e) {}
    if (typeof currentBookId !== 'undefined' && currentBookId === bookId) {
      if (typeof closeBook === 'function') closeBook();
    }
    if (typeof renderBooksList === 'function') renderBooksList();
    if (typeof showToast === 'function') showToast('📚 Book removed');
  });
}

function filterChatHistory() {
  const searchQuery = document.getElementById('chunks-search-input')?.value?.toLowerCase().trim() || '';
  const items = document.querySelectorAll('#chat-history-list .chat-history-item');
  items.forEach(item => {
    const title = item.querySelector('.chat-history-title')?.textContent?.toLowerCase() || '';
    const preview = item.querySelector('.chat-history-preview')?.textContent?.toLowerCase() || '';
    const matches = !searchQuery || title.includes(searchQuery) || preview.includes(searchQuery);
    item.style.display = matches ? '' : 'none';
  });
}

function goHome() {
  // Save current chat before leaving so it appears in sidebar
  if (typeof saveCurrentChat === 'function') saveCurrentChat();
  if (typeof displayChatHistory === 'function') displayChatHistory();

  // If the user has a study plan, sf-original-welcome (the book picker) will be
  // replaced by sfRenderDashboard after ~50ms.  Hide it BEFORE showing the
  // welcome-screen so the book picker never flickers into view.
  try {
    var _sfst = JSON.parse(localStorage.getItem('chunks_study_flow_v2') || 'null');
    if (_sfst && _sfst.examName) {
      var _orig = document.getElementById('sf-original-welcome');
      if (_orig) _orig.style.display = 'none';
    }
  } catch(e) {}

  // FIX dark flash: hide main content and show welcome in the SAME synchronous
  // paint. No fade-in — instant swap. The dark flash was caused by a frame gap
  // during the opacity 0→1 transition while both main and welcome were invisible.
  document.getElementById('main-header').style.display = 'none';
  document.getElementById('main-container').style.display = 'none';

  const ws = document.getElementById('welcome-screen');
  ws.classList.remove('fading-out');
  ws.classList.remove('ws-entering');
  ws.classList.remove('hidden');  // ← show instantly, same paint as hiding main
  // FIX: user navigated away — don't restore this chat on refresh
  try { sessionStorage.removeItem('chunks_last_chat_id'); } catch(e) {}
  // Close sidebar after navigating
  const sidebar = document.getElementById('chat-history-sidebar');
  sidebar.classList.remove('open');
  sidebar.classList.remove('hover-open');
  // Re-render study dashboard (welcome-screen is now visible so sfRenderDashboard won't bail early)
  if (typeof sfRenderDashboard === 'function') {
    setTimeout(sfRenderDashboard, 50);
  }
}

// ==========================================
// ==========================================
// MOLECULE DATA — SVG DRAWINGS + COLOR THEMES
// Matches molecule-design.html visual style
// ==========================================
function getMoleculeData(name) {
  const n = (name || '').toLowerCase().trim();

  const THEMES = {
    // accent, glow, bubbleBg, bubbleBorder
    water:    ['#38bdf8','rgba(56,189,248,0.15)','radial-gradient(circle at 35% 30%,rgba(56,189,248,0.25),rgba(14,116,144,0.18))','rgba(56,189,248,0.4)'],
    oxygen:   ['#f87171','rgba(248,113,113,0.15)','radial-gradient(circle at 35% 30%,rgba(248,113,113,0.25),rgba(185,28,28,0.14))','rgba(248,113,113,0.4)'],
    co2:      ['#a78bfa','rgba(167,139,250,0.15)','radial-gradient(circle at 35% 30%,rgba(167,139,250,0.25),rgba(109,40,217,0.12))','rgba(167,139,250,0.4)'],
    ammonia:  ['#4ade80','rgba(74,222,128,0.15)','radial-gradient(circle at 35% 30%,rgba(74,222,128,0.25),rgba(21,128,61,0.14))','rgba(74,222,128,0.4)'],
    nacl:     ['#a3e635','rgba(163,230,53,0.14)','radial-gradient(circle at 35% 30%,rgba(163,230,53,0.22),rgba(63,98,18,0.14))','rgba(163,230,53,0.35)'],
    methane:  ['#fb923c','rgba(251,146,60,0.15)','radial-gradient(circle at 35% 30%,rgba(251,146,60,0.25),rgba(180,60,10,0.14))','rgba(251,146,60,0.4)'],
    glucose:  ['#fbbf24','rgba(251,191,36,0.15)','radial-gradient(circle at 35% 30%,rgba(251,191,36,0.22),rgba(146,64,14,0.14))','rgba(251,191,36,0.38)'],
    ethanol:  ['#34d399','rgba(52,211,153,0.14)','radial-gradient(circle at 35% 30%,rgba(52,211,153,0.22),rgba(6,95,70,0.14))','rgba(52,211,153,0.38)'],
    hcl:      ['#f472b6','rgba(244,114,182,0.15)','radial-gradient(circle at 35% 30%,rgba(244,114,182,0.22),rgba(157,23,77,0.14))','rgba(244,114,182,0.38)'],
    default:  ['#818cf8','rgba(102,126,234,0.14)','radial-gradient(circle at 35% 30%,rgba(102,126,234,0.22),rgba(67,46,130,0.18))','rgba(102,126,234,0.35)'],
  };

  // SVG molecule drawings (68×68 viewbox, matching molecule-design.html)
  const SVGS = {
    water: `<svg viewBox="0 0 68 68" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="34" cy="30" r="12" fill="rgba(248,113,113,0.82)" stroke="rgba(255,160,160,0.5)" stroke-width="1.2"/>
      <text x="34" y="34.5" text-anchor="middle" font-family="system-ui,sans-serif" font-size="9" font-weight="800" fill="white">O</text>
      <circle cx="13" cy="47" r="7.5" fill="rgba(255,255,255,0.75)" stroke="rgba(255,255,255,0.35)" stroke-width="1"/>
      <text x="13" y="50.5" text-anchor="middle" font-family="system-ui,sans-serif" font-size="7" font-weight="700" fill="#111">H</text>
      <circle cx="55" cy="47" r="7.5" fill="rgba(255,255,255,0.75)" stroke="rgba(255,255,255,0.35)" stroke-width="1"/>
      <text x="55" y="50.5" text-anchor="middle" font-family="system-ui,sans-serif" font-size="7" font-weight="700" fill="#111">H</text>
      <line x1="23" y1="38" x2="19" y2="43" stroke="rgba(255,255,255,0.4)" stroke-width="1.8" stroke-linecap="round"/>
      <line x1="45" y1="38" x2="49" y2="43" stroke="rgba(255,255,255,0.4)" stroke-width="1.8" stroke-linecap="round"/>
    </svg>`,

    'carbon dioxide': `<svg viewBox="0 0 68 68" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="34" cy="34" r="10" fill="rgba(167,139,250,0.85)" stroke="rgba(200,180,255,0.5)" stroke-width="1.2"/>
      <text x="34" y="38" text-anchor="middle" font-family="system-ui,sans-serif" font-size="8" font-weight="800" fill="white">C</text>
      <circle cx="9" cy="34" r="8.5" fill="rgba(248,113,113,0.78)" stroke="rgba(255,150,150,0.4)" stroke-width="1"/>
      <text x="9" y="37.5" text-anchor="middle" font-family="system-ui,sans-serif" font-size="7" font-weight="700" fill="white">O</text>
      <circle cx="59" cy="34" r="8.5" fill="rgba(248,113,113,0.78)" stroke="rgba(255,150,150,0.4)" stroke-width="1"/>
      <text x="59" y="37.5" text-anchor="middle" font-family="system-ui,sans-serif" font-size="7" font-weight="700" fill="white">O</text>
      <line x1="17.5" y1="31" x2="24" y2="31" stroke="rgba(255,255,255,0.45)" stroke-width="1.6" stroke-linecap="round"/>
      <line x1="17.5" y1="37" x2="24" y2="37" stroke="rgba(255,255,255,0.45)" stroke-width="1.6" stroke-linecap="round"/>
      <line x1="44" y1="31" x2="50.5" y2="31" stroke="rgba(255,255,255,0.45)" stroke-width="1.6" stroke-linecap="round"/>
      <line x1="44" y1="37" x2="50.5" y2="37" stroke="rgba(255,255,255,0.45)" stroke-width="1.6" stroke-linecap="round"/>
    </svg>`,

    ammonia: `<svg viewBox="0 0 68 68" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="34" cy="28" r="11" fill="rgba(74,222,128,0.82)" stroke="rgba(134,239,172,0.4)" stroke-width="1.2"/>
      <text x="34" y="32.5" text-anchor="middle" font-family="system-ui,sans-serif" font-size="9" font-weight="800" fill="white">N</text>
      <circle cx="11" cy="50" r="7" fill="rgba(255,255,255,0.72)" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>
      <text x="11" y="53.5" text-anchor="middle" font-family="system-ui,sans-serif" font-size="6.5" font-weight="700" fill="#111">H</text>
      <circle cx="34" cy="55" r="7" fill="rgba(255,255,255,0.72)" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>
      <text x="34" y="58.5" text-anchor="middle" font-family="system-ui,sans-serif" font-size="6.5" font-weight="700" fill="#111">H</text>
      <circle cx="57" cy="50" r="7" fill="rgba(255,255,255,0.72)" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>
      <text x="57" y="53.5" text-anchor="middle" font-family="system-ui,sans-serif" font-size="6.5" font-weight="700" fill="#111">H</text>
      <line x1="24.5" y1="36.5" x2="17" y2="44" stroke="rgba(255,255,255,0.4)" stroke-width="1.7" stroke-linecap="round"/>
      <line x1="34" y1="39" x2="34" y2="48" stroke="rgba(255,255,255,0.4)" stroke-width="1.7" stroke-linecap="round"/>
      <line x1="43.5" y1="36.5" x2="51" y2="44" stroke="rgba(255,255,255,0.4)" stroke-width="1.7" stroke-linecap="round"/>
    </svg>`,

    'sodium chloride': `<svg viewBox="0 0 68 68" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="19" cy="34" r="13" fill="rgba(251,191,36,0.82)" stroke="rgba(253,224,71,0.4)" stroke-width="1.2"/>
      <text x="19" y="38.5" text-anchor="middle" font-family="system-ui,sans-serif" font-size="8.5" font-weight="800" fill="#1a1a1a">Na⁺</text>
      <circle cx="50" cy="34" r="12" fill="rgba(167,243,208,0.78)" stroke="rgba(110,231,183,0.4)" stroke-width="1.2"/>
      <text x="50" y="38" text-anchor="middle" font-family="system-ui,sans-serif" font-size="8.5" font-weight="800" fill="#1a1a1a">Cl⁻</text>
      <line x1="32" y1="34" x2="38" y2="34" stroke="rgba(255,255,255,0.5)" stroke-width="1.5" stroke-dasharray="2,2" stroke-linecap="round"/>
    </svg>`,

    oxygen: `<svg viewBox="0 0 68 68" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="34" r="12" fill="rgba(248,113,113,0.82)" stroke="rgba(255,150,150,0.4)" stroke-width="1.2"/>
      <text x="20" y="38.5" text-anchor="middle" font-family="system-ui,sans-serif" font-size="9" font-weight="800" fill="white">O</text>
      <circle cx="48" cy="34" r="12" fill="rgba(248,113,113,0.82)" stroke="rgba(255,150,150,0.4)" stroke-width="1.2"/>
      <text x="48" y="38.5" text-anchor="middle" font-family="system-ui,sans-serif" font-size="9" font-weight="800" fill="white">O</text>
      <line x1="32" y1="30" x2="36" y2="30" stroke="rgba(255,255,255,0.5)" stroke-width="1.8" stroke-linecap="round"/>
      <line x1="32" y1="38" x2="36" y2="38" stroke="rgba(255,255,255,0.5)" stroke-width="1.8" stroke-linecap="round"/>
    </svg>`,

    methane: `<svg viewBox="0 0 68 68" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="34" cy="34" r="10" fill="rgba(251,146,60,0.85)" stroke="rgba(253,186,116,0.4)" stroke-width="1.2"/>
      <text x="34" y="38" text-anchor="middle" font-family="system-ui,sans-serif" font-size="8.5" font-weight="800" fill="white">C</text>
      <circle cx="34" cy="9" r="7" fill="rgba(255,255,255,0.72)" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>
      <text x="34" y="12.5" text-anchor="middle" font-family="system-ui,sans-serif" font-size="6.5" font-weight="700" fill="#111">H</text>
      <circle cx="34" cy="59" r="7" fill="rgba(255,255,255,0.72)" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>
      <text x="34" y="62.5" text-anchor="middle" font-family="system-ui,sans-serif" font-size="6.5" font-weight="700" fill="#111">H</text>
      <circle cx="9" cy="34" r="7" fill="rgba(255,255,255,0.72)" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>
      <text x="9" y="37.5" text-anchor="middle" font-family="system-ui,sans-serif" font-size="6.5" font-weight="700" fill="#111">H</text>
      <circle cx="59" cy="34" r="7" fill="rgba(255,255,255,0.72)" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>
      <text x="59" y="37.5" text-anchor="middle" font-family="system-ui,sans-serif" font-size="6.5" font-weight="700" fill="#111">H</text>
      <line x1="34" y1="24" x2="34" y2="16" stroke="rgba(255,255,255,0.4)" stroke-width="1.7" stroke-linecap="round"/>
      <line x1="34" y1="44" x2="34" y2="52" stroke="rgba(255,255,255,0.4)" stroke-width="1.7" stroke-linecap="round"/>
      <line x1="24" y1="34" x2="16" y2="34" stroke="rgba(255,255,255,0.4)" stroke-width="1.7" stroke-linecap="round"/>
      <line x1="44" y1="34" x2="52" y2="34" stroke="rgba(255,255,255,0.4)" stroke-width="1.7" stroke-linecap="round"/>
    </svg>`,

    glucose: `<svg viewBox="0 0 68 68" fill="none" xmlns="http://www.w3.org/2000/svg">
      <polygon points="34,8 52,20 52,44 34,56 16,44 16,20" fill="rgba(251,191,36,0.15)" stroke="rgba(251,191,36,0.5)" stroke-width="1.2"/>
      <circle cx="34" cy="8"  r="6" fill="rgba(248,113,113,0.8)" stroke="rgba(255,150,150,0.4)" stroke-width="1"/><text x="34" y="11.5" text-anchor="middle" font-size="5.5" font-weight="800" fill="white" font-family="system-ui">O</text>
      <circle cx="52" cy="20" r="6" fill="rgba(167,139,250,0.8)" stroke="rgba(200,180,255,0.4)" stroke-width="1"/><text x="52" y="23.5" text-anchor="middle" font-size="5.5" font-weight="800" fill="white" font-family="system-ui">C</text>
      <circle cx="52" cy="44" r="6" fill="rgba(248,113,113,0.8)" stroke="rgba(255,150,150,0.4)" stroke-width="1"/><text x="52" y="47.5" text-anchor="middle" font-size="5.5" font-weight="800" fill="white" font-family="system-ui">O</text>
      <circle cx="34" cy="56" r="6" fill="rgba(167,139,250,0.8)" stroke="rgba(200,180,255,0.4)" stroke-width="1"/><text x="34" y="59.5" text-anchor="middle" font-size="5.5" font-weight="800" fill="white" font-family="system-ui">C</text>
      <circle cx="16" cy="44" r="6" fill="rgba(248,113,113,0.8)" stroke="rgba(255,150,150,0.4)" stroke-width="1"/><text x="16" y="47.5" text-anchor="middle" font-size="5.5" font-weight="800" fill="white" font-family="system-ui">O</text>
      <circle cx="16" cy="20" r="6" fill="rgba(167,139,250,0.8)" stroke="rgba(200,180,255,0.4)" stroke-width="1"/><text x="16" y="23.5" text-anchor="middle" font-size="5.5" font-weight="800" fill="white" font-family="system-ui">C</text>
    </svg>`,

    ethanol: `<svg viewBox="0 0 68 68" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="34" r="9" fill="rgba(167,139,250,0.82)" stroke="rgba(200,180,255,0.4)" stroke-width="1.1"/>
      <text x="16" y="37.5" text-anchor="middle" font-family="system-ui,sans-serif" font-size="7.5" font-weight="800" fill="white">C</text>
      <circle cx="38" cy="34" r="9" fill="rgba(167,139,250,0.82)" stroke="rgba(200,180,255,0.4)" stroke-width="1.1"/>
      <text x="38" y="37.5" text-anchor="middle" font-family="system-ui,sans-serif" font-size="7.5" font-weight="800" fill="white">C</text>
      <circle cx="58" cy="34" r="8" fill="rgba(248,113,113,0.78)" stroke="rgba(255,150,150,0.4)" stroke-width="1"/>
      <text x="58" y="37.5" text-anchor="middle" font-family="system-ui,sans-serif" font-size="7" font-weight="700" fill="white">O</text>
      <line x1="25" y1="34" x2="29" y2="34" stroke="rgba(255,255,255,0.45)" stroke-width="1.8" stroke-linecap="round"/>
      <line x1="47" y1="34" x2="50" y2="34" stroke="rgba(255,255,255,0.45)" stroke-width="1.8" stroke-linecap="round"/>
      <circle cx="16" cy="18" r="5.5" fill="rgba(255,255,255,0.65)" stroke="rgba(255,255,255,0.25)" stroke-width="1"/>
      <text x="16" y="21" text-anchor="middle" font-family="system-ui,sans-serif" font-size="5" font-weight="700" fill="#111">H</text>
      <line x1="16" y1="25" x2="16" y2="23.5" stroke="rgba(255,255,255,0.35)" stroke-width="1.4" stroke-linecap="round"/>
    </svg>`,

    default: `<svg viewBox="0 0 68 68" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="34" cy="34" r="14" fill="rgba(102,126,234,0.7)" stroke="rgba(150,170,255,0.4)" stroke-width="1.5"/>
      <text x="34" y="38" text-anchor="middle" font-family="system-ui,sans-serif" font-size="12" font-weight="800" fill="white">⚛</text>
      <circle cx="14" cy="22" r="6.5" fill="rgba(255,255,255,0.55)" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>
      <circle cx="54" cy="22" r="6.5" fill="rgba(255,255,255,0.55)" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>
      <line x1="20" y1="27" x2="27" y2="30" stroke="rgba(255,255,255,0.35)" stroke-width="1.6" stroke-linecap="round"/>
      <line x1="48" y1="27" x2="41" y2="30" stroke="rgba(255,255,255,0.35)" stroke-width="1.6" stroke-linecap="round"/>
    </svg>`,
  };

  // Formula labels
  const FORMULAS = {
    water: 'H₂O', 'carbon dioxide': 'CO₂', ammonia: 'NH₃',
    'sodium chloride': 'NaCl', oxygen: 'O₂', methane: 'CH₄',
    glucose: 'C₆H₁₂O₆', ethanol: 'C₂H₅OH',
    'hydrochloric acid': 'HCl', 'sulfuric acid': 'H₂SO₄',
    'nitric acid': 'HNO₃', 'acetic acid': 'CH₃COOH',
  };

  // Alias mapping
  const ALIASES = {
    'h2o': 'water', 'o2': 'oxygen', 'co2': 'carbon dioxide',
    'nh3': 'ammonia', 'nacl': 'sodium chloride', 'ch4': 'methane',
    'hcl': 'hydrochloric acid', 'h2so4': 'sulfuric acid',
    'hno3': 'nitric acid', 'ch3cooh': 'acetic acid', 'salt': 'sodium chloride',
    'alcohol': 'ethanol', 'vinegar': 'acetic acid',
  };

  const key = ALIASES[n] || n;
  const themeKey = {
    water:'water', oxygen:'oxygen', 'carbon dioxide':'co2',
    ammonia:'ammonia', 'sodium chloride':'nacl', methane:'methane',
    glucose:'glucose', ethanol:'ethanol', 'hydrochloric acid':'hcl',
  }[key] || 'default';

  const t = THEMES[themeKey];
  const cssVars = `--mol-accent:${t[0]};--mol-glow:${t[1]};--mol-bubble-bg:${t[2]};--mol-bubble-border:${t[3]};`;

  return {
    svg: SVGS[key] || SVGS.default,
    formula: FORMULAS[key] || null,
    cssVars,
    accent: t[0],
  };
}

// ==========================================
// INLINE MOLECULE CHAT CARD
// ==========================================
function createMoleculeChatCard(moleculeName) {
  const chat = document.getElementById('chat-messages');
  if (!chat) return;

  const molData = getMoleculeData(moleculeName);
  const card = document.createElement('div');
  card.style.cssText = 'display:flex; justify-content:flex-start; padding: 4px 16px 12px;';
  card.innerHTML = `
    <div class="molecule-chat-card" onclick="openMoleculeModal('${moleculeName}')" style="${molData.cssVars}">
      <div class="molecule-chat-card-icon">
        ${molData.svg}
      </div>
      <div class="molecule-chat-card-info">
        <div class="molecule-chat-card-name">${moleculeName.charAt(0).toUpperCase()+moleculeName.slice(1)}</div>
        ${molData.formula ? `<div class="molecule-chat-card-formula">${molData.formula}</div>` : ''}
        <div class="molecule-chat-card-hint">Click to view 3D structure</div>
      </div>
    </div>
  `;

  // Insert before typing indicator
  const typing = document.getElementById('typing-indicator');
  chat.insertBefore(card, typing);
  chat.scrollTop = chat.scrollHeight;
}

// ==========================================
// MOLECULE AUTO-DETECTION
// ==========================================
function detectMoleculeFromText(text) {
  if (!text) return null;
  const t = text.toLowerCase();

  // Map of keywords → PubChem-recognized molecule name
  const moleculeMap = {
    // Common molecules by name
    'glucose': 'glucose',
    'fructose': 'fructose',
    'sucrose': 'sucrose',
    'lactose': 'lactose',
    'water': 'water',
    'h2o': 'water',
    'oxygen': 'oxygen',
    'o2': 'oxygen',
    'carbon dioxide': 'carbon dioxide',
    'co2': 'carbon dioxide',
    'methane': 'methane',
    'ch4': 'methane',
    'ethanol': 'ethanol',
    'alcohol': 'ethanol',
    'ammonia': 'ammonia',
    'nh3': 'ammonia',
    'sodium chloride': 'sodium chloride',
    'nacl': 'sodium chloride',
    'salt': 'sodium chloride',
    'hydrochloric acid': 'hydrochloric acid',
    'hcl': 'hydrochloric acid',
    'sulfuric acid': 'sulfuric acid',
    'h2so4': 'sulfuric acid',
    'nitric acid': 'nitric acid',
    'hno3': 'nitric acid',
    'acetic acid': 'acetic acid',
    'vinegar': 'acetic acid',
    'ch3cooh': 'acetic acid',
    'benzene': 'benzene',
    'c6h6': 'benzene',
    'caffeine': 'caffeine',
    'aspirin': 'aspirin',
    'acetaminophen': 'acetaminophen',
    'paracetamol': 'acetaminophen',
    'ibuprofen': 'ibuprofen',
    'cholesterol': 'cholesterol',
    'atp': 'adenosine triphosphate',
    'adenosine triphosphate': 'adenosine triphosphate',
    'dna': 'deoxyadenosine',
    'sodium hydroxide': 'sodium hydroxide',
    'naoh': 'sodium hydroxide',
    'hydrogen peroxide': 'hydrogen peroxide',
    'h2o2': 'hydrogen peroxide',
    'nitrogen': 'nitrogen',
    'n2': 'nitrogen',
    'hydrogen': 'hydrogen',
    'h2': 'hydrogen',
    'ozone': 'ozone',
    'o3': 'ozone',
    'acetone': 'acetone',
    'formaldehyde': 'formaldehyde',
    'urea': 'urea',
    'glycine': 'glycine',
    'alanine': 'alanine',
    'lysine': 'lysine',
    'dopamine': 'dopamine',
    'serotonin': 'serotonin',
    'adrenaline': 'adrenaline',
    'epinephrine': 'epinephrine',
    'insulin': 'insulin',
    'penicillin': 'penicillin',
    'vitamin c': 'ascorbic acid',
    'ascorbic acid': 'ascorbic acid',
    'citric acid': 'citric acid',
    'lactic acid': 'lactic acid',
    'phosphoric acid': 'phosphoric acid',
    'sodium bicarbonate': 'sodium bicarbonate',
    'baking soda': 'sodium bicarbonate',
    'nahco3': 'sodium bicarbonate',
    'calcium carbonate': 'calcium carbonate',
    'caco3': 'calcium carbonate',
    'ethylene': 'ethylene',
    'propane': 'propane',
    'butane': 'butane',
    'toluene': 'toluene',
    'methanol': 'methanol',
    'glycerol': 'glycerol',
    'glycerin': 'glycerol',
    'stearic acid': 'stearic acid',
    'oleic acid': 'oleic acid',
    'ribose': 'ribose',
    'deoxyribose': 'deoxyribose',
    'adenine': 'adenine',
    'guanine': 'guanine',
    'cytosine': 'cytosine',
    'thymine': 'thymine',
    'uracil': 'uracil',
  };

  // Check for formula patterns like C6H12O6
  const formulaMatch = t.match(/\b([a-z][a-z0-9]*(?:[a-z][a-z0-9]*)*)\b/g);

  // Check molecule map
  for (const [keyword, molecule] of Object.entries(moleculeMap)) {
    if (t.includes(keyword)) return molecule;
  }

  return null;
}

// Profile popup
function toggleProfilePopup() {
  const popup = document.getElementById('profile-popup');
  popup.classList.toggle('open');
}

function closeProfilePopup() {
  document.getElementById('profile-popup').classList.remove('open');
}

// Close profile popup when clicking outside
document.addEventListener('click', function(e) {
  const popup = document.getElementById('profile-popup');
  const footer = document.querySelector('.sidebar-profile-footer');
  if (popup && footer && !footer.contains(e.target)) {
    popup.classList.remove('open');
  }
});

// ==========================================
// CLOSE BOOK
// ==========================================
function closeBook() {
  // Clear PDF state
  if (typeof pdfDoc !== 'undefined') pdfDoc = null;
  if (typeof currentPdfName !== 'undefined') currentPdfName = null;
  localStorage.removeItem('eightysix_current_book');
  // Clear the uploaded PDF from IndexedDB cache
  if (typeof idbClearPDF === 'function') idbClearPDF().catch(() => {});

  // Hide close button
  const btn = document.getElementById('close-book-btn');
  if (btn) btn.style.display = 'none';
  // Hide floating viewer close button
  const viewerCloseBtn = document.getElementById('pdf-viewer-close-btn');
  if (viewerCloseBtn) viewerCloseBtn.style.display = 'none';

  // Clear PDF viewer
  const viewer = document.getElementById('pdf-viewer');
  if (viewer) {
    viewer.innerHTML = '';
    const ph = document.createElement('div');
    ph.className = 'pdf-placeholder';
    ph.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:16px;';
    ph.innerHTML = `<svg class="icon" width="48" height="48" style="opacity:0.25"><use href="#icon-document"/></svg>
      <h2 style="color:#aaa;margin-bottom:8px;font-size:18px;">No Textbook Selected</h2>
      <p style="color:#666;margin-bottom:16px;">Browse the library to select a textbook</p>
      <button class="toolbar-btn" onclick="openLibraryModal()" style="padding:10px 22px;background:linear-gradient(135deg,#667eea,#764ba2);color:white;border-radius:10px;font-weight:600;font-size:14px;">
        <svg class="icon" width="16" height="16" style="vertical-align:middle;margin-right:6px;"><use href="#icon-books"/></svg>Browse Library</button>`;
    viewer.appendChild(ph);
  }

  // Switch to fullscreen general AI mode
  const mainContainer = document.getElementById('main-container');
  if (mainContainer) {
    mainContainer.classList.add('chat-fullscreen');
    window._generalChatMode = true; try { sessionStorage.setItem('chunks_general_mode', '1'); } catch(e) {}
  }

  // Reset page counter
  const pageTotal = document.getElementById('page-total');
  if (pageTotal) pageTotal.textContent = '-';
  const pageInput = document.getElementById('page-input');
  if (pageInput) { pageInput.value = 1; }

  if (typeof createNewChat === 'function') createNewChat();
  if (typeof showToast === 'function') showToast('📖 Book closed — General AI mode');
}

// ==========================================
// WELCOME SCREEN HELPERS
// ==========================================
function enterChatFromWelcome(prefill) {
  if (prefill === 'flashcard' && isFreeTier()) {
    showToast('🔒 Flashcards are a Pro & Ultra feature. Upgrade to unlock!');
    openPricingModal();
    return;
  }
  createNewChat();
  document.getElementById('welcome-screen').classList.add('hidden');
  document.getElementById('main-header').style.display = 'flex';
  const mainContainer = document.getElementById('main-container');
  mainContainer.style.display = 'flex';

  // No book loaded → fullscreen general AI mode
  const hasBook = !!(localStorage.getItem('eightysix_current_book') && typeof pdfDoc !== 'undefined' && pdfDoc);
  if (!hasBook) {
    mainContainer.classList.add('chat-fullscreen');
    window._generalChatMode = true; try { sessionStorage.setItem('chunks_general_mode', '1'); } catch(e) {}
    const wm = document.getElementById('welcome-msg-text');
    if (wm) wm.textContent = "Hi! I'm your AI study assistant. Ask me anything — I'll give you detailed answers without needing a textbook.";
  } else {
    mainContainer.classList.remove('chat-fullscreen');
    window._generalChatMode = false; try { sessionStorage.setItem('chunks_general_mode', '0'); } catch(e) {}
  }

  const input = document.getElementById('chat-input');
  if (input) {
    if (prefill) input.value = 'Create flashcards for ';
    input.focus();
  }
}

function sendWelcomeChat() {
  const input = document.getElementById('welcome-chat-input');
  const text = input ? input.value.trim() : '';
  if (!text) return;
  createNewChat();
  document.getElementById('welcome-screen').classList.add('hidden');
  document.getElementById('main-header').style.display = 'flex';
  const mainContainer = document.getElementById('main-container');
  mainContainer.style.display = 'flex';

  const hasBook = !!(localStorage.getItem('eightysix_current_book') && typeof pdfDoc !== 'undefined' && pdfDoc);
  if (!hasBook) {
    mainContainer.classList.add('chat-fullscreen');
    window._generalChatMode = true; try { sessionStorage.setItem('chunks_general_mode', '1'); } catch(e) {}
  } else {
    mainContainer.classList.remove('chat-fullscreen');
    window._generalChatMode = false; try { sessionStorage.setItem('chunks_general_mode', '0'); } catch(e) {}
  }

  const chatInput = document.getElementById('chat-input');
  if (chatInput) {
    chatInput.value = text;
    sendMessage();
  }
  input.value = '';
}


// ==========================================
// SETTINGS MODALS JS
// ==========================================
function getPrefs() {
  return JSON.parse(localStorage.getItem('chunks_personalization') || '{}');
}
function getSettings() {
  return JSON.parse(localStorage.getItem('chunks_settings') || '{}');
}

function openSettingsModal(id) {
  document.getElementById(id).classList.add('open');
  if (id === 'modal-edit-profile') loadProfileData();
  if (id === 'modal-personalization') loadPersonalizationData();
  if (id === 'modal-settings') loadSettingsData();
  _saveView('settings', id);
}

function closeSettingsModal(id) {
  document.getElementById(id).classList.remove('open');
  _clearView('settings');
}

// Close on overlay click
document.querySelectorAll('.settings-modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', function(e) {
    if (e.target === this) {
      this.classList.remove('open');
      _clearView('settings');
    }
  });
});

// Keyboard shortcut support
document.addEventListener('keydown', function(e) {
  if (e.ctrlKey && e.key === 'm') { e.preventDefault(); createNewChat(); }
  if (e.ctrlKey && e.key === 'b') { e.preventDefault(); toggleChatHistory(); }
  if (e.ctrlKey && e.key === 'l') { e.preventDefault(); if(typeof clearChat==='function') clearChat(); }
  if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
    e.preventDefault();
    const inp = document.getElementById('chat-input');
    if (inp) inp.focus();
  }
  if (e.key === 'Escape') {
    document.querySelectorAll('.settings-modal-overlay.open').forEach(m => m.classList.remove('open'));
    closeProfilePopup();
  }
});

// -- EDIT PROFILE ------------------------------
const avatarColors = [
  'linear-gradient(135deg,#667eea,#764ba2)',
  'linear-gradient(135deg,#f093fb,#f5576c)',
  'linear-gradient(135deg,#4facfe,#00f2fe)',
  'linear-gradient(135deg,#43e97b,#38f9d7)',
  'linear-gradient(135deg,#fa709a,#fee140)',
  'linear-gradient(135deg,#a18cd1,#fbc2eb)',
];
let currentAvatarColor = avatarColors[0];

function loadProfileData() {
  const saved = JSON.parse(localStorage.getItem('chunks_profile') || '{}');
  const fallbackName = currentUser?.name || saved.name || '';
  const fallbackEmail = currentUser?.email || saved.email || '';
  document.getElementById('profile-name-input').value = fallbackName;
  document.getElementById('profile-email-input').value = fallbackEmail;
  document.getElementById('profile-bio-input').value = saved.bio || '';
  currentAvatarColor = saved.avatarColor || avatarColors[0];
  updateAvatarPreview();
}

function updateAvatarPreview() {
  const name = document.getElementById('profile-name-input').value.trim();
  const initial = name ? name[0].toUpperCase() : 'C';
  const preview = document.getElementById('profile-avatar-preview');
  if (preview) {
    preview.textContent = initial;
    preview.style.background = currentAvatarColor;
  }
}

function randomizeAvatarColor() {
  const current = currentAvatarColor;
  const others = avatarColors.filter(c => c !== current);
  currentAvatarColor = others[Math.floor(Math.random() * others.length)];
  updateAvatarPreview();
}

function saveProfile() {
  const name = document.getElementById('profile-name-input').value.trim() || currentUser?.name || 'User';
  const email = document.getElementById('profile-email-input').value.trim();
  const bio = document.getElementById('profile-bio-input').value.trim();
  const profile = { name, email, bio, avatarColor: currentAvatarColor };
  localStorage.setItem('chunks_profile', JSON.stringify(profile));

  // Update sidebar display
  const nameEl = document.querySelector('.sidebar-profile-name');
  const avatarEl = document.querySelector('.sidebar-profile-avatar');
  if (nameEl) nameEl.textContent = name;
  if (avatarEl) {
    avatarEl.textContent = name[0].toUpperCase();
    avatarEl.style.background = currentAvatarColor;
  }
  closeSettingsModal('modal-edit-profile');
  showToast('Profile saved!');
}

// -- PERSONALIZATION ------------------------------
function loadPersonalizationData() {
  const saved = JSON.parse(localStorage.getItem('chunks_personalization') || '{}');
  document.getElementById('pref-compact').checked = saved.compact || false;
  document.getElementById('pref-bubbles').checked = saved.bubbles !== false;
  document.getElementById('pref-autoscroll').checked = saved.autoscroll !== false;
  document.getElementById('pref-mathjax').checked = saved.mathjax !== false;
  if (saved.defaultMode) document.getElementById('pref-default-mode').value = saved.defaultMode;
  if (saved.defaultComplexity) document.getElementById('pref-default-complexity').value = saved.defaultComplexity;
  // Load AI Memory fields
  const mem = JSON.parse(localStorage.getItem('chunks_ai_memory') || '{}');
  const nameEl = document.getElementById('memory-name');
  const levelEl = document.getElementById('memory-level');
  const subjectEl = document.getElementById('memory-subject');
  const extraEl = document.getElementById('memory-extra');
  if (nameEl) nameEl.value = mem.name || '';
  if (levelEl) levelEl.value = mem.level || '';
  if (subjectEl) subjectEl.value = mem.subject || '';
  if (extraEl) extraEl.value = mem.extra || '';
}

function saveAIMemory() {
  const name    = document.getElementById('memory-name')?.value.trim() || '';
  const level   = document.getElementById('memory-level')?.value || '';
  const subject = document.getElementById('memory-subject')?.value.trim() || '';
  const extra   = document.getElementById('memory-extra')?.value.trim() || '';
  localStorage.setItem('chunks_ai_memory', JSON.stringify({ name, level, subject, extra }));
  // Flash "Saved" badge briefly
  const badge = document.getElementById('memory-saved-badge');
  if (badge) {
    badge.style.display = 'block';
    clearTimeout(badge._hideTimer);
    badge._hideTimer = setTimeout(() => badge.style.display = 'none', 1500);
  }
}

function savePersonalizationAndClose() {
  applyPersonalization();
  // Save AI Memory
  const name = document.getElementById('memory-name')?.value.trim() || '';
  const level = document.getElementById('memory-level')?.value || '';
  const subject = document.getElementById('memory-subject')?.value.trim() || '';
  const extra = document.getElementById('memory-extra')?.value.trim() || '';
  const mem = { name, level, subject, extra };
  localStorage.setItem('chunks_ai_memory', JSON.stringify(mem));
  const badge = document.getElementById('memory-saved-badge');
  if (badge) { badge.style.display = 'block'; setTimeout(() => badge.style.display = 'none', 1500); }
  closeSettingsModal('modal-personalization');
  showToast('Memory & Preferences saved!');
}

function getAIMemoryString() {
  const mem = JSON.parse(localStorage.getItem('chunks_ai_memory') || '{}');
  const parts = [];
  if (mem.name) parts.push('Name: ' + mem.name);
  if (mem.level) parts.push('Education level: ' + mem.level);
  if (mem.subject) parts.push('Studying: ' + mem.subject);
  if (mem.extra) parts.push(mem.extra);
  return parts.join('. ');
}

function applyPersonalization() {
  const prefs = {
    compact: document.getElementById('pref-compact').checked,
    bubbles: document.getElementById('pref-bubbles').checked,
    autoscroll: document.getElementById('pref-autoscroll').checked,
    mathjax: document.getElementById('pref-mathjax').checked,
    defaultMode: document.getElementById('pref-default-mode').value,
    defaultComplexity: document.getElementById('pref-default-complexity').value,
  };
  localStorage.setItem('chunks_personalization', JSON.stringify(prefs));

  // Apply compact mode immediately
  document.body.classList.toggle('compact-mode', prefs.compact);

  // Apply mode to actual mode dropdown immediately
  const modeSelect = document.getElementById('mode-select');
  if (modeSelect && prefs.defaultMode) {
    modeSelect.value = prefs.defaultMode.toLowerCase();
    if (typeof setMode === 'function') setMode(prefs.defaultMode.toLowerCase());
  }

  // Apply complexity slider immediately
  const slider = document.getElementById('complexity-slider-compact');
  const label = document.getElementById('complexity-value-compact');
  if (slider && prefs.defaultComplexity) {
    slider.value = prefs.defaultComplexity;
    if (label) label.textContent = prefs.defaultComplexity;
    if (typeof updateComplexity === 'function') updateComplexity(prefs.defaultComplexity);
  }

  // Hide/show molecule bubbles immediately
  const bubbleContainer = document.getElementById('molecule-bubbles-container');
  if (bubbleContainer) bubbleContainer.style.display = prefs.bubbles ? '' : 'none';
}

function resetPersonalization() {
  // Set explicit defaults: mode=study, complexity=5
  const defaults = { defaultMode: 'study', defaultComplexity: '5', mathjax: true, bubbles: true };
  localStorage.setItem('chunks_personalization', JSON.stringify(defaults));
  loadPersonalizationData();
  applyPersonalization();
  showToast('Preferences reset to defaults');
}

// -- SETTINGS ------------------------------
function loadSettingsData() {
  const saved = JSON.parse(localStorage.getItem('chunks_settings') || '{}');
  const urlInput = document.getElementById('settings-server-url');
  if (urlInput) urlInput.value = saved.serverUrl || window.location.origin;
  const autojump = document.getElementById('settings-autojump');
  if (autojump) autojump.checked = saved.autojump !== false;
  const highlight = document.getElementById('settings-highlight');
  if (highlight) highlight.checked = saved.highlight !== false;
}

function saveSettings() {
  const autojumpEl = document.getElementById('settings-autojump');
  const highlightEl = document.getElementById('settings-highlight');
  const existing = JSON.parse(localStorage.getItem('chunks_settings') || '{}');
  const settings = {
    serverUrl: document.getElementById('settings-server-url')?.value || existing.serverUrl || '',
    autojump: autojumpEl ? autojumpEl.checked : (existing.autojump !== false),
    highlight: highlightEl ? highlightEl.checked : (existing.highlight !== false),
  };
  localStorage.setItem('chunks_settings', JSON.stringify(settings));
}

function saveSettingsAndClose() {
  saveSettings();
  closeSettingsModal('modal-settings');
  showToast('Settings saved!');
}

function exportChats() {
  const sessions = localStorage.getItem('eightysix_chat_sessions') || '{}';
  const blob = new Blob([sessions], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'chunks-chats-' + new Date().toISOString().split('T')[0] + '.json';
  a.click();
  showToast('Chats exported!');
}

function clearAllChats() {
  if (!confirm('Clear ALL chat history? This cannot be undone.')) return;
  localStorage.removeItem('eightysix_chat_sessions');
  if (typeof chatSessions !== 'undefined') { chatSessions = {}; }
  if (typeof createNewChat === 'function') createNewChat();
  if (typeof displayChatHistory === 'function') displayChatHistory();
  closeSettingsModal('modal-settings');
  showToast('Chat history cleared');
}

function clearProgress() {
  if (!confirm('Clear all progress, flashcards and exam results? This cannot be undone.')) return;
  // Progress tracking
  localStorage.removeItem('chunks_progress');
  // Saved flashcard sets
  localStorage.removeItem('chunks_saved_flashcards');
  // Saved exam results
  localStorage.removeItem('chunks_saved_exams');
  // NOTE: daily message counters (chunks_free_msgs_*) are intentionally NOT cleared here.
  // They are enforced server-side and the local copy is display-only.
  showToast('Progress, flashcards & exam results cleared ✓');
}

function clearAllData() {
  if (!confirm('Reset EVERYTHING? All chats, progress, and preferences will be deleted.')) return;
  // Preserve auth keys so the user stays signed in after reset
  const AUTH_KEYS = ['chunks_user', 'chunks_guest', 'supabase.auth.token',
                     `sb-${(SUPABASE_URL||'').split('//')[1]?.split('.')[0]||'chunks'}-auth-token`];
  const saved = {};
  AUTH_KEYS.forEach(k => { const v = localStorage.getItem(k); if (v !== null) saved[k] = v; });
  // Preserve Supabase session keys (dynamic pattern)
  Object.keys(localStorage).forEach(k => {
    if (k.startsWith('sb-') && k.endsWith('-auth-token')) saved[k] = localStorage.getItem(k);
  });
  // Preserve daily message counters — display-only, but keeping them avoids
  // showing a misleading "0 messages used" counter after a reset.
  // The real limit is enforced server-side and cannot be bypassed by clearing these.
  Object.keys(localStorage).forEach(k => {
    if (k.startsWith('chunks_free_msgs_')) saved[k] = localStorage.getItem(k);
  });
  localStorage.clear();
  Object.entries(saved).forEach(([k, v]) => localStorage.setItem(k, v));
  // Also clear PDF cache
  if ('caches' in window) {
    caches.delete('chunks-pdf-cache-v1').catch(() => {});
  }
  showToast('All data cleared. Reloading...');
  setTimeout(() => location.reload(), 1200);
}

async function clearPDFCache() {
  if (!confirm('Clear cached PDFs? They will be re-downloaded next time you open a book.')) return;
  try {
    await caches.delete('chunks-pdf-cache-v1');
    showToast('PDF cache cleared!');
  } catch(e) {
    showToast('Could not clear cache: ' + e.message);
  }
}

// handleLogout defined in auth system above

// -- HELP ------------------------------
function toggleHelp(btn) {
  const item = btn.closest('.help-item');
  item.classList.toggle('open');
}

// -- FIRST-RUN ONBOARDING TOUR ----------------
(function initOnboarding() {
  if (localStorage.getItem('chunks_onboarded')) return;

  const _onboardIcons = [
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>',
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M12 8v8"/><path d="M8 12h8"/></svg>',
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>'
  ];
  const steps = [
    {
      title: 'Welcome to Chunks',
      body: 'Your AI-powered study companion. Let\'s take a quick tour — it\'ll only take 10 seconds.',
      action: 'Next'
    },
    {
      title: 'Step 1 — Open a textbook',
      body: 'Click <strong>Open Library</strong> to pick a textbook, or upload your own PDF. The AI will read it and answer your questions.',
      action: 'Got it'
    },
    {
      title: 'Step 2 — Study smarter',
      body: 'Use <strong>Study / Exam / Practice / Summary</strong> modes to get different types of help. Hit the <strong>Flashcards</strong> button to generate a study deck.',
      action: 'Got it'
    },
    {
      title: 'Step 3 — Chemistry tools',
      body: 'Mention any element or molecule and the <strong>Periodic Table</strong> and <strong>3D viewer</strong> auto-appear. Press <kbd style="background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:4px;padding:1px 5px;">/</kbd> anytime to focus the chat.',
      action: 'Get started'
    }
  ];

  let step = 0;

  const overlay = document.createElement('div');
  overlay.id = 'onboarding-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:100000;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);';

  function renderStep() {
    const s = steps[step];
    const icon = _onboardIcons[step] || _onboardIcons[0];
    overlay.innerHTML = `
      <div style="background:#16171f;border:1px solid rgba(102,126,234,0.22);border-radius:20px;padding:32px;max-width:400px;width:90%;box-shadow:0 24px 64px rgba(0,0,0,0.7);text-align:center;position:relative;">
        <div style="width:52px;height:52px;background:linear-gradient(135deg,#667eea,#764ba2);border-radius:14px;display:flex;align-items:center;justify-content:center;margin:0 auto 18px;">${icon}</div>
        <div style="font-size:17px;font-weight:700;color:white;margin-bottom:10px;">${s.title}</div>
        <div style="font-size:13.5px;color:rgba(255,255,255,0.5);line-height:1.65;margin-bottom:26px;">${s.body}</div>
        <div style="display:flex;align-items:center;justify-content:center;gap:14px;">
          <div style="display:flex;gap:5px;">
            ${steps.map((_, i) => `<div style="width:6px;height:6px;border-radius:50%;background:${i === step ? '#667eea' : 'rgba(255,255,255,0.15)'};"></div>`).join('')}
          </div>
          <button id="onboarding-next-btn" style="background:linear-gradient(135deg,#667eea,#764ba2);color:white;border:none;border-radius:10px;padding:10px 24px;font-size:13.5px;font-weight:700;cursor:pointer;font-family:inherit;">${s.action}</button>
        </div>
        <button onclick="document.body.removeChild(document.getElementById('onboarding-overlay'));localStorage.setItem('chunks_onboarded','1');" style="position:absolute;top:14px;right:16px;background:none;border:none;color:rgba(255,255,255,0.25);font-size:16px;cursor:pointer;line-height:1;" title="Skip tour">✕</button>
      </div>`;

    document.getElementById('onboarding-next-btn').onclick = function() {
      step++;
      if (step >= steps.length) {
        document.body.removeChild(overlay);
        localStorage.setItem('chunks_onboarded', '1');
      } else {
        renderStep();
      }
    };
  }

  // Show after a short delay so the page loads fully
  setTimeout(() => {
    if (!localStorage.getItem('chunks_onboarded')) {
      document.body.appendChild(overlay);
      renderStep();
    }
  }, 1500);
})();

// -- TOAST ------------------------------
function showToast(msg) {
  let toast = document.getElementById('chunks-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'chunks-toast';
    toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#667eea;color:white;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,0.3);transition:opacity 0.3s;';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, 2200);
}

// Load personalization on startup
(function() {
  // Render persisted books immediately on load
  setTimeout(() => { if (typeof renderChunksBooks === 'function') renderChunksBooks(); }, 100);

  const saved = JSON.parse(localStorage.getItem('chunks_personalization') || '{}');
  if (saved.compact) document.body.classList.add('compact-mode');
  const profile = JSON.parse(localStorage.getItem('chunks_profile') || '{}');
  if (profile.name) {
    const nameEl = document.querySelector('.sidebar-profile-name');
    const avatarEl = document.querySelector('.sidebar-profile-avatar');
    if (nameEl) nameEl.textContent = profile.name;
    if (avatarEl) {
      avatarEl.textContent = profile.name[0].toUpperCase();
      if (profile.avatarColor) avatarEl.style.background = profile.avatarColor;
    }
  }

  // Apply default study mode
  if (saved.defaultMode) {
    const modeSelect = document.getElementById('mode-select');
    if (modeSelect) {
      modeSelect.value = saved.defaultMode.toLowerCase();
      if (typeof setMode === 'function') setMode(saved.defaultMode.toLowerCase());
    }
  }

  // Apply default complexity
  if (saved.defaultComplexity) {
    const slider = document.getElementById('complexity-slider-compact');
    const label = document.getElementById('complexity-value-compact');
    if (slider) slider.value = saved.defaultComplexity;
    if (label) label.textContent = saved.defaultComplexity;
  }

  // Apply bubble visibility
  if (saved.bubbles === false) {
    const bc = document.getElementById('molecule-bubbles-container');
    if (bc) bc.style.display = 'none';
  }
})();


// ==========================================
// AUTH / LOGIN SYSTEM - SUPABASE SUBSCRIPTION
// ==========================================

// -- CONFIG: Replace with your actual Supabase project values --------------
// Config loaded at startup from /api/config (see window load handler at bottom)
// Never hardcode keys in source — set SUPABASE_URL + SUPABASE_ANON_KEY env vars on backend
let SUPABASE_URL = '';
let SUPABASE_ANON_KEY = '';
// -------------------------------------------------------------------------

let supabaseClient = null;
let currentUser = null;
let isGuestMode = false;

// Lazy-load Supabase SDK and initialize
async function getSupabase() {
  if (supabaseClient) return supabaseClient;
  if (!window.supabase) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  // FIX: Guard against empty config — createClient('','') throws and breaks auth entirely
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.warn('[Chunks] Supabase config not loaded — auth features unavailable until backend responds');
    return null;
  }
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return supabaseClient;
}

async function initAuth() {
  const guestMode = localStorage.getItem('chunks_guest');
  if (guestMode === 'true') {
    isGuestMode = true;
    hideAuthScreen();
    document.getElementById('guest-banner').classList.add('visible');
    setProfileDisplay('Guest', 'G', 'Guest Mode', 'rgba(255,255,255,0.15)');
    return;
  }

  // FIX 1: If we have a cached user in localStorage, show app immediately
  // while we verify the Supabase session in the background.
  // This prevents the flash-to-login on every page refresh.
  const cachedUser = (() => {
    try { return JSON.parse(localStorage.getItem('chunks_user') || 'null'); } catch(e) { return null; }
  })();
  if (cachedUser && cachedUser.email) {
    currentUser = cachedUser;
    isGuestMode = false;
    hideAuthScreen();
    updateProfileFromUser(currentUser);
  }

  // Detect OAuth redirect: Supabase puts #access_token=... in the URL
  const hasOAuthHash = window.location.hash &&
    (window.location.hash.includes('access_token') ||
     window.location.hash.includes('type=recovery') ||
     window.location.hash.includes('type=signup'));

  try {
    const sb = await getSupabase();

    // FIX: If Supabase config is not available (backend cold start / network error),
    // fall back gracefully — show login card but keep welcome screen visible.
    if (!sb) {
      console.warn('[Chunks] Supabase not available — showing welcome page, login deferred');
      if (!cachedUser || !cachedUser.email) {
        // Show auth screen but DON'T hide welcome — overlay approach
        showLoginCard();
      }
      return;
    }

    // Track whether getSession already handled auth so onAuthStateChange
    // doesn't double-fire checkSubscriptionAndLogin
    let _authHandled = false;

    const { data: { session } } = await sb.auth.getSession();

    if (session) {
      _authHandled = true;
      // Clean the hash from the URL so reloads don't re-trigger OAuth flow
      if (hasOAuthHash) {
        history.replaceState(null, '', window.location.pathname + window.location.search);
      }
      await checkSubscriptionAndLogin(session.user);
    } else if (hasOAuthHash) {
      // OAuth redirect in progress — Supabase is still exchanging the token.
      // Show a neutral loading state instead of the login card.
      _showAuthLoading();
    } else if (cachedUser && cachedUser.email) {
      // FIX 1: No live session but cached user exists — keep them in the app.
      // Supabase session may have expired but user is the same. Don't evict them.
      // They'll be re-prompted only on explicit logout.
      hideAuthScreen();
    } else {
      showLoginCard();
    }

    // Listen for future auth changes (e.g. after OAuth redirect finishes)
    sb.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session) {
        if (_authHandled) return; // already handled by getSession above
        _authHandled = true;
        // Clean hash now that token is exchanged
        if (window.location.hash) {
          history.replaceState(null, '', window.location.pathname + window.location.search);
        }
        await checkSubscriptionAndLogin(session.user);
      } else if (event === 'SIGNED_OUT') {
        _authHandled = false;
        currentUser = null;
        showLoginCard();
      } else if (event === 'TOKEN_REFRESHED' && session) {
        // Silent refresh — no UI change needed
      }
    });
  } catch(e) {
    console.error('Auth init error:', e);
    // FIX 1: If Supabase fails (network issue etc.) but we have cached user, stay logged in
    if (cachedUser && cachedUser.email) {
      hideAuthScreen();
    } else {
      showLoginCard();
    }
  }
}

// Show a neutral "signing in..." state while OAuth token is being exchanged
function _showAuthLoading() {
  const loginCard = document.getElementById('auth-card-login');
  const pendingCard = document.getElementById('auth-card-pending');
  const authScreen = document.getElementById('auth-screen');
  // Hide both cards briefly — just show the animated background
  if (loginCard) loginCard.style.display = 'none';
  if (pendingCard) pendingCard.style.display = 'none';
  if (authScreen) authScreen.classList.remove('hidden');
  // Fallback: if onAuthStateChange never fires within 5s, show login card
  setTimeout(() => {
    const stillLoading = !currentUser && !isGuestMode;
    if (stillLoading && loginCard) {
      loginCard.style.display = 'flex';
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }, 5000);
}

async function checkSubscriptionAndLogin(user) {
  // Stop any existing watchers from a previous session
  _stopWatchers();

  try {
    const sb = await getSupabase();
    const { data, error } = await sb
      .from('users')
      .select('email, approved, name, plan, subscription_end')
      .eq('email', user.email)
      .single();

    if (error || !data) {
      const { error: upsertError } = await sb.from('users').upsert({
        email: user.email,
        name: user.user_metadata?.full_name || user.email,
        plan: 'free',
        approved: false,
        paid: false,
        payment_ready: false,
        created_at: new Date().toISOString()
      }, { onConflict: 'email' });
      if (upsertError) {
        console.error('[Chunks] UPSERT FAILED:', upsertError.message, upsertError);
      } else {
      }
      // New user — log them in as free tier
      currentUser = {
        email: user.email,
        name: user.user_metadata?.full_name || user.email,
        picture: user.user_metadata?.avatar_url || '',
        tier: 'free'
      };
      localStorage.setItem('chunks_user', JSON.stringify(currentUser));
      isGuestMode = false;
      hideAuthScreen();
      updateProfileFromUser(currentUser);
      showToast('Welcome to Chunks! You\'re on the free plan. 🎉');
      _joinPresence(sb, { type: 'user', email: user.email });
      _startApprovalWatcher(user.email, sb);
      return;
    }

    if (!data.approved) {
      // Unapproved — log them in as free tier
      currentUser = {
        email: user.email,
        name: data.name || user.user_metadata?.full_name || user.email,
        picture: user.user_metadata?.avatar_url || '',
        tier: 'free'
      };
      localStorage.setItem('chunks_user', JSON.stringify(currentUser));
      isGuestMode = false;
      hideAuthScreen();
      updateProfileFromUser(currentUser);
      showToast('Welcome back! You\'re on the free plan.');
      _joinPresence(sb, { type: 'user', email: user.email });
      _startApprovalWatcher(user.email, sb);
      return;
    }

    // ✅ Check subscription expiry — downgrade to free tier instead of signing out
    if (data.subscription_end && new Date(data.subscription_end) < new Date()) {
      showToast('⏰ Your subscription has expired. You\'ve been moved to the free plan.');
      currentUser = {
        email: user.email,
        name: data.name || user.user_metadata?.full_name || user.email,
        picture: user.user_metadata?.avatar_url || '',
        tier: 'free'
      };
      localStorage.setItem('chunks_user', JSON.stringify(currentUser));
      isGuestMode = false;
      hideAuthScreen();
      updateProfileFromUser(currentUser);
      _joinPresence(sb, { type: 'user', email: user.email });
      _startRevokeWatcher(user.email, sb);
      return;
    }

    // ✅ Approved - let them in
    currentUser = {
      email: user.email,
      name: data.name || user.user_metadata?.full_name || user.email,
      picture: user.user_metadata?.avatar_url || '',
      tier: data.plan || 'pro'
    };
    localStorage.setItem('chunks_user', JSON.stringify(currentUser));
    isGuestMode = false;
    hideAuthScreen();
    updateProfileFromUser(currentUser);
    showToast('Welcome back, ' + (currentUser.name.split(' ')[0] || 'there') + '! 👋');

    // -- Broadcast presence ------------------------------------------------
    _joinPresence(sb, { type: 'user', email: user.email });

    // -- Watch for revoke: Realtime + fallback poll ----------------------
    _startRevokeWatcher(user.email, sb);
  } catch(e) {
    console.error('Subscription check error:', e);
    // Fall back to free tier on error
    currentUser = {
      email: user.email,
      name: user.user_metadata?.full_name || user.email,
      picture: user.user_metadata?.avatar_url || '',
      tier: 'free'
    };
    localStorage.setItem('chunks_user', JSON.stringify(currentUser));
    isGuestMode = false;
    hideAuthScreen();
    updateProfileFromUser(currentUser);
    showToast('Signed in on free plan.');
  }
}

// -- Presence broadcasting --------------------------------------------------
let _presenceChannel = null;

function _joinPresence(sb, meta) {
  // Leave any existing presence channel first
  if (_presenceChannel) {
    try { sb.removeChannel(_presenceChannel); } catch(e) {}
    _presenceChannel = null;
  }
  const key = 'user_' + Math.random().toString(36).substr(2, 9);
  _presenceChannel = sb.channel('app-presence', {
    config: { presence: { key } }
  });
  _presenceChannel
    .on('presence', { event: 'sync' }, () => {})
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await _presenceChannel.track(meta);
      }
    });
}

// -- Watcher state ---------------------------------------------------------
let _watcherChannel = null;
let _watcherPoller  = null;
let _watcherActive  = false;

function _stopWatchers() {
  _watcherActive = false;
  if (_watcherPoller)  { clearInterval(_watcherPoller);  _watcherPoller  = null; }
  if (_watcherChannel) {
    try { _watcherChannel.unsubscribe(); } catch(e) {}
    _watcherChannel = null;
  }
}

function _startRevokeWatcher(email, sb) {
  _watcherActive = true;
  let _acting = false;
  let _planActing = false;

  async function _doRevoke() {
    if (_acting) return;
    _acting = true;
    _stopWatchers();
    showToast('⚠️ Your access has been revoked.');
    await new Promise(r => setTimeout(r, 800));
    localStorage.removeItem('chunks_user');
    try { await sb.auth.signOut(); } catch(e) {}
    history.replaceState(null, '', window.location.pathname + window.location.search);
    location.reload();
  }

  function _doExpire() {
    if (_acting) return;
    _acting = true;
    _stopWatchers();
    showToast('⏰ Your subscription has expired. You\'ve been moved to the free plan.');
    if (currentUser) {
      currentUser.tier = 'free';
      localStorage.setItem('chunks_user', JSON.stringify(currentUser));
      updateProfileFromUser(currentUser);
    }
    _forceDarkMode();
  }

  function _forceDarkMode() {
    document.body.classList.remove('light-mode');
    localStorage.setItem('chunks_theme', 'dark');
    const label = document.getElementById('theme-label');
    const icon  = document.getElementById('theme-icon');
    if (label) label.textContent = 'Light mode';
    if (icon) icon.innerHTML = '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
  }

  function _doPlanChange(newPlan) {
    if (!currentUser) return;
    if (newPlan === currentUser.tier) return;
    if (_planActing) return;
    _planActing = true;
    currentUser.tier = newPlan;
    localStorage.setItem('chunks_user', JSON.stringify(currentUser));
    updateProfileFromUser(currentUser);
    if (newPlan === 'free') {
      showToast('📢 Your plan has been reset to Free Tier.');
      _forceDarkMode();
    } else if (newPlan === 'pro') {
      showToast('🎉 Your plan has been upgraded to Pro!');
    } else if (newPlan === 'ultra') {
      showToast('⚡ Your plan has been upgraded to Ultra!');
    }
    setTimeout(() => { _planActing = false; }, 2000);
  }

  // Primary: Supabase Realtime — fires instantly on DB change
  const chanName = 'revoke-' + email.replace(/[^a-z0-9]/gi,'-');
  _watcherChannel = sb.channel(chanName)
    .on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'users',
      filter: 'email=eq.' + email
    }, payload => {
      if (!payload.new.approved) { _doRevoke(); return; }
      if (payload.new.subscription_end && new Date(payload.new.subscription_end) < new Date()) {
        _doExpire();
        return;
      }
      if (payload.new.plan && currentUser && payload.new.plan !== currentUser.tier) {
        _doPlanChange(payload.new.plan);
      }
    })
    .subscribe();

  // Fallback poll every 3 seconds — catches changes if Realtime is slow
  _watcherPoller = setInterval(async () => {
    if (!_watcherActive) return;
    try {
      const { data } = await sb.from('users').select('approved, subscription_end, plan').eq('email', email).single();
      if (!data) return;
      if (!data.approved) { _doRevoke(); return; }
      if (data.subscription_end && new Date(data.subscription_end) < new Date()) {
        _doExpire();
        return;
      }
      if (data.plan && currentUser && data.plan !== currentUser.tier) {
        _doPlanChange(data.plan);
      }
    } catch(e) {}
  }, 3000);
}

function _startApprovalWatcher(email, sb) {
  _watcherActive = true;
  let _acting = false;

  function _doApprove() {
    if (_acting) return;
    _acting = true;
    _stopWatchers();
    // Show green top banner
    let banner = document.getElementById('approval-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'approval-banner';
      banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:linear-gradient(90deg,#34d399,#059669);color:white;text-align:center;padding:16px;font-size:15px;font-weight:700;box-shadow:0 4px 20px rgba(52,211,153,0.4);';
      document.body.appendChild(banner);
    }
    banner.textContent = '✓ Account approved! Logging you in...';
    setTimeout(() => location.reload(), 800);
  }

  // Primary: Supabase Realtime
  const chanName = 'approve-' + email.replace(/[^a-z0-9]/gi,'-');
  _watcherChannel = sb.channel(chanName)
    .on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'users',
      filter: 'email=eq.' + email
    }, payload => {
      if (payload.new.approved) _doApprove();
    })
    .subscribe();

  // Fallback poll every 3 seconds
  _watcherPoller = setInterval(async () => {
    if (!_watcherActive) return;
    try {
      const { data } = await sb.from('users').select('approved').eq('email', email).single();
      if (data && data.approved) _doApprove();
    } catch(e) {}
  }, 3000);
}

function showLoginCard() {
  document.getElementById('auth-card-login').style.display = 'flex';
  document.getElementById('auth-card-pending').style.display = 'none';
  document.getElementById('auth-screen').classList.remove('hidden');
}

function showPendingCard(email) {
  document.getElementById('auth-card-login').style.display = 'none';
  const pendingCard = document.getElementById('auth-card-pending');
  pendingCard.style.display = 'flex';
  document.getElementById('pending-email').textContent = email || '';
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('welcome-screen').classList.add('hidden');

  // Start watching for approval
  getSupabase().then(sb => _startApprovalWatcher(email, sb));
}

function hideAuthScreen() {
  document.getElementById('auth-screen').classList.add('hidden');
  var noFlash = document.getElementById('__no-flash');
  if (noFlash) noFlash.remove();
  const lastChatId = (() => { try { return sessionStorage.getItem('chunks_last_chat_id'); } catch(e) { return null; } })();
  const hasSavedChat = lastChatId && (typeof chatSessions !== 'undefined') && chatSessions[lastChatId];
  if (!hasSavedChat) {
    const ws = document.getElementById('welcome-screen');
    // FIX: use ws-entering class for clean opacity 0→1 transition, no black flash
    ws.style.opacity = '';
    ws.style.display = '';
    ws.style.pointerEvents = '';
    ws.classList.add('ws-entering');
    ws.classList.remove('hidden');
    ws.classList.remove('fading-out');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        ws.classList.remove('ws-entering');
      });
    });
  }
}

function showAuthScreen() {
  localStorage.removeItem('chunks_guest');
  isGuestMode = false;
  document.getElementById('guest-banner').classList.remove('visible');
  showLoginCard();
  document.getElementById('welcome-screen').classList.add('hidden');
  document.getElementById('main-header').style.display = 'none';
  document.getElementById('main-container').style.display = 'none';
}

// ── In-App Browser Detection ──────────────────────────────────────────────
(function detectInAppBrowser() {
  const ua = navigator.userAgent || '';
  const isInApp =
    /FBAN|FBAV|FB_IAB|Instagram|LinkedInApp|Twitter|Snapchat|TikTok|Pinterest|Line\/|KAKAOTALK|MicroMessenger|GSA\//.test(ua) ||
    (ua.includes('Mobile') && ua.includes('Safari') && !ua.includes('CriOS') && !ua.includes('FxiOS') &&
      !/^Mozilla\/5\.0 \(iPhone.*Safari\//.test(ua) === false && /AppleWebKit/.test(ua) &&
      window.navigator.standalone === false && /FBAN|FBAV|Instagram/.test(ua));

  // Simpler, more reliable check
  const isInAppSimple = /FBAN|FBAV|FBIOS|FB_IAB|Instagram|LinkedInApp|Twitter\/|Snapchat|TikTok|Pinterest|Line\/|KAKAOTALK|MicroMessenger|GSA\//.test(ua);

  if (isInAppSimple) {
    const warning = document.getElementById('inapp-browser-warning');
    const urlDisplay = document.getElementById('inapp-url-display');
    if (warning) warning.style.display = 'block';
    if (urlDisplay) urlDisplay.textContent = window.location.href;

    // Also dim the Google button and show tooltip
    const googleBtn = document.querySelector('.auth-google-btn');
    if (googleBtn) {
      googleBtn.style.opacity = '0.4';
      googleBtn.style.cursor = 'not-allowed';
      googleBtn.title = 'Open in Safari or Chrome to sign in with Google';
    }
  }
})();

function copyAppUrl() {
  const url = window.location.href;
  const btn = document.getElementById('inapp-copy-btn');
  navigator.clipboard.writeText(url).then(() => {
    if (btn) { btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = 'Copy link', 2000); }
  }).catch(() => {
    // Fallback for browsers that block clipboard
    const ta = document.createElement('textarea');
    ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    if (btn) { btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = 'Copy link', 2000); }
  });
}

async function signInWithGoogle() {
  // Block sign-in attempt in known in-app browsers
  const ua = navigator.userAgent || '';
  const isInAppSimple = /FBAN|FBAV|FBIOS|FB_IAB|Instagram|LinkedInApp|Twitter\/|Snapchat|TikTok|Pinterest|Line\/|KAKAOTALK|MicroMessenger|GSA\//.test(ua);
  if (isInAppSimple) {
    showToast('⚠️ Please open this page in Safari or Chrome to sign in.');
    return;
  }

  const btn = document.querySelector('.auth-google-btn');
  btn.innerHTML = '<span style="opacity:0.7">Redirecting to Google...</span>';
  btn.disabled = true;
  try {
    const sb = await getSupabase();
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + window.location.pathname }
    });
    if (error) throw error;
  } catch(e) {
    showToast('Sign in failed: ' + (e.message || 'Unknown error'));
    btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>Continue with Google`;
    btn.disabled = false;
  }
}

function continueAsGuest() {
  isGuestMode = true;
  localStorage.setItem('chunks_guest', 'true');
  hideAuthScreen();
  document.getElementById('guest-banner').classList.add('visible');
  setProfileDisplay('Guest', 'G', 'Guest Mode', 'rgba(255,255,255,0.15)');
  // Broadcast guest presence
  getSupabase().then(sb => _joinPresence(sb, { type: 'guest', email: 'guest_' + Date.now() }));
}

function setProfileDisplay(name, initial, plan, avatarBg) {
  const nameEl = document.querySelector('.sidebar-profile-name');
  const avatarEl = document.querySelector('.sidebar-profile-avatar');
  const planEl = document.querySelector('.sidebar-profile-plan');
  if (nameEl) nameEl.textContent = name;
  if (avatarEl) { avatarEl.textContent = initial; if (avatarBg) avatarEl.style.background = avatarBg; }
  if (planEl) planEl.textContent = plan;
}

function updateProfileFromUser(user) {
  // Trigger cross-device chat sync every time a user is confirmed logged in
  setTimeout(() => onAuthReadySyncChats(), 500);
  if (!user) return;
  const name = user.name || 'User';
  const planLabel = user.tier === 'ultra' ? '⚡ Ultra Plan'
    : user.tier === 'pro' ? '✦ Pro Plan'
    : 'Free Plan';
  const avatarBg = user.tier === 'ultra'
    ? 'linear-gradient(135deg, #f59e0b, #d97706)'
    : user.tier === 'pro'
    ? 'linear-gradient(135deg, #667eea, #764ba2)'
    : 'linear-gradient(135deg, #374151, #1f2937)';
  setProfileDisplay(name, name[0].toUpperCase(), planLabel, avatarBg);

  // Always sync chunks_profile with the logged-in user's real data
  const existing = JSON.parse(localStorage.getItem('chunks_profile') || '{}');
  const updated = { ...existing, name: name, email: user.email || existing.email || '' };
  localStorage.setItem('chunks_profile', JSON.stringify(updated));

  const nameInput = document.getElementById('profile-name-input');
  const emailInput = document.getElementById('profile-email-input');
  if (nameInput) nameInput.value = name;
  if (emailInput) emailInput.value = user.email || '';
}

async function handleLogout() {
  if (!confirm('Are you sure you want to log out?')) return;
  try { _stopWatchers(); } catch(e) {}
  currentUser = null;
  isGuestMode = false;
  localStorage.removeItem('chunks_user');
  localStorage.removeItem('chunks_guest');
  try {
    const sb = await getSupabase();
    await sb.auth.signOut();
  } catch(e) { console.warn('Supabase signOut error:', e); }
  showToast('Logged out successfully');
  history.replaceState(null, '', window.location.pathname + window.location.search);
  setTimeout(() => location.reload(), 800);
}

// Tier helpers
function isFreeTier() {
  if (isGuestMode) return true;
  const u = JSON.parse(localStorage.getItem('chunks_user') || '{}');
  return u.tier === 'free';
}

// Free tier: 20 AI messages per day (tracked in localStorage)
function getFreeTierMessageCount() {
  const key = 'chunks_free_msgs_' + new Date().toISOString().slice(0,10);
  return parseInt(localStorage.getItem(key) || '0', 10);
}
function incrementFreeTierMessageCount() {
  const key = 'chunks_free_msgs_' + new Date().toISOString().slice(0,10);
  const count = getFreeTierMessageCount() + 1;
  localStorage.setItem(key, count);
  return count;
}
function freeTierMessageLimitReached() {
  return isFreeTier() && getFreeTierMessageCount() >= 20;
}

// Guest mode restrictions
function isFeatureAllowed(feature) {
  if (!isGuestMode) return true;
  const guestAllowed = ['ask', 'molecule', 'pdf'];
  return guestAllowed.includes(feature);
}

// Free tier feature gate — PDF upload, exam, practice, 3D molecule viewer are locked
function isFreeTierFeatureAllowed(feature) {
  if (!isFreeTier() && !isGuestMode) return true;
  const freeLocked = ['pdf', 'exam', 'practice', 'molecule'];
  return !freeLocked.includes(feature);
}

// Run on page load — wait for /api/config to resolve before initialising auth
window.addEventListener('load', async () => {
  // FIX: Retry /api/config up to 3 times with increasing timeout (handles Railway cold starts).
  // initAuth() is called immediately even if config fails so welcome page shows without delay.
  async function _fetchConfig(attempt) {
    const _configUrl = (window.API_URL || window.__API_URL__ || 'https://chunksai.up.railway.app') + '/api/config';
    const timeoutMs = attempt === 1 ? 5000 : attempt === 2 ? 8000 : 12000;
    try {
      const _ctrl = new AbortController();
      const _tid  = setTimeout(() => _ctrl.abort(), timeoutMs);
      const cfg   = await fetch(_configUrl, { signal: _ctrl.signal }).then(r => r.json());
      clearTimeout(_tid);
      if (cfg.supabaseUrl) {
        SUPABASE_URL      = cfg.supabaseUrl      || '';
        SUPABASE_ANON_KEY = cfg.supabaseAnonKey  || '';
        // If auth hadn't initialized yet (first attempt succeeded quickly), this is fine.
        // If supabaseClient is already null from a prior failed attempt, re-initialize.
        if (!supabaseClient && SUPABASE_URL && SUPABASE_ANON_KEY) {
          console.log('[Chunks] Config loaded on attempt', attempt, '— re-initialising auth');
          supabaseClient = null; // reset so getSupabase() recreates it
          initAuth();
        }
        return true;
      }
    } catch (e) {
      console.warn(`[Chunks] /api/config attempt ${attempt} failed:`, e.message || e);
    }
    return false;
  }

  // Start immediately (don't await — let welcome render first)
  _fetchConfig(1).then(ok => {
    if (!ok) setTimeout(() => _fetchConfig(2).then(ok2 => {
      if (!ok2) setTimeout(() => _fetchConfig(3), 8000);
    }), 5000);
  });

  initAuth();
  setTimeout(restoreActiveTab, 400);
  setTimeout(_restoreView, 700);
});


// ==========================================
// VIEW STATE PERSISTENCE
// Saves which overlay/modal is open so refresh restores the same page.
// ==========================================

function _saveView(view, data) {
  try { sessionStorage.setItem('chunks_view', JSON.stringify({ view, data: data || null })); } catch(e) {}
}
function _clearView(view) {
  try {
    const cur = JSON.parse(sessionStorage.getItem('chunks_view') || 'null');
    if (!view || (cur && cur.view === view)) sessionStorage.removeItem('chunks_view');
  } catch(e) {}
}
function _restoreView() {
  try {
    const saved = JSON.parse(sessionStorage.getItem('chunks_view') || 'null');
    // Always remove the no-flash suppressor — even if nothing to restore
    var noFlash = document.getElementById('__no-flash');
    if (noFlash) noFlash.remove();
    if (!saved) return;
    switch (saved.view) {
      case 'pt':
        if (typeof openPT === 'function') openPT();
        break;
      case 'settings':
        if (saved.data && typeof openSettingsModal === 'function') openSettingsModal(saved.data);
        break;
      case 'molecule':
        if (saved.data && typeof openMoleculeModal === 'function') openMoleculeModal(saved.data);
        break;
      case 'pricing':
        if (typeof openPricingModal === 'function') openPricingModal();
        break;
    }
  } catch(e) {
    // Failsafe — remove suppressor so page isn't invisible
    var noFlash = document.getElementById('__no-flash');
    if (noFlash) noFlash.remove();
  }
}

// ==========================================
// PERIODIC TABLE
// ==========================================

const PT_ELEMENTS = [
  {n:1,  sym:'H',  name:'Hydrogen',      mass:'1.008',    cat:'nonmetal',   group:1,  period:1, config:'1s¹',                    melt:'-259.1°C', boil:'-252.9°C', density:'0.0000899 g/cm³', discovered:'1766', state:'Gas',    electronegativity:'2.20', radius:'53 pm',  desc:'The lightest and most abundant element in the universe.'},
  {n:2,  sym:'He', name:'Helium',         mass:'4.003',    cat:'noble-gas',  group:18, period:1, config:'1s²',                    melt:'-272.2°C', boil:'-268.9°C', density:'0.0001785 g/cm³',discovered:'1868', state:'Gas',    electronegativity:'—',    radius:'31 pm',  desc:'A colorless, odorless noble gas used in balloons and cryogenics.'},
  {n:3,  sym:'Li', name:'Lithium',        mass:'6.941',    cat:'alkali',     group:1,  period:2, config:'[He] 2s¹',               melt:'180.5°C',  boil:'1342°C',   density:'0.534 g/cm³',     discovered:'1817', state:'Solid',  electronegativity:'0.98', radius:'167 pm', desc:'A soft, silvery alkali metal used in batteries and ceramics.'},
  {n:4,  sym:'Be', name:'Beryllium',      mass:'9.012',    cat:'alkaline',   group:2,  period:2, config:'[He] 2s²',               melt:'1287°C',   boil:'2468°C',   density:'1.85 g/cm³',      discovered:'1797', state:'Solid',  electronegativity:'1.57', radius:'112 pm', desc:'A lightweight but toxic alkaline earth metal.'},
  {n:5,  sym:'B',  name:'Boron',          mass:'10.811',   cat:'metalloid',  group:13, period:2, config:'[He] 2s² 2p¹',           melt:'2076°C',   boil:'3927°C',   density:'2.34 g/cm³',      discovered:'1808', state:'Solid',  electronegativity:'2.04', radius:'87 pm',  desc:'A metalloid essential for plant growth and used in glass.'},
  {n:6,  sym:'C',  name:'Carbon',         mass:'12.011',   cat:'nonmetal',   group:14, period:2, config:'[He] 2s² 2p²',           melt:'3550°C',   boil:'4027°C',   density:'2.26 g/cm³',      discovered:'Ancient',state:'Solid', electronegativity:'2.55', radius:'77 pm',  desc:'The basis of all organic life; forms diamond and graphite.'},
  {n:7,  sym:'N',  name:'Nitrogen',       mass:'14.007',   cat:'nonmetal',   group:15, period:2, config:'[He] 2s² 2p³',           melt:'-210.0°C', boil:'-195.8°C', density:'0.001251 g/cm³',  discovered:'1772', state:'Gas',    electronegativity:'3.04', radius:'56 pm',  desc:'Makes up 78% of Earth\'s atmosphere; essential for life.'},
  {n:8,  sym:'O',  name:'Oxygen',         mass:'15.999',   cat:'nonmetal',   group:16, period:2, config:'[He] 2s² 2p⁴',           melt:'-218.3°C', boil:'-183.0°C', density:'0.001429 g/cm³',  discovered:'1774', state:'Gas',    electronegativity:'3.44', radius:'48 pm',  desc:'Essential for respiration and combustion; 21% of atmosphere.'},
  {n:9,  sym:'F',  name:'Fluorine',       mass:'18.998',   cat:'halogen',    group:17, period:2, config:'[He] 2s² 2p⁵',           melt:'-219.6°C', boil:'-188.1°C', density:'0.001696 g/cm³',  discovered:'1886', state:'Gas',    electronegativity:'3.98', radius:'42 pm',  desc:'The most electronegative and reactive of all elements.'},
  {n:10, sym:'Ne', name:'Neon',           mass:'20.180',   cat:'noble-gas',  group:18, period:2, config:'[He] 2s² 2p⁶',           melt:'-248.6°C', boil:'-246.1°C', density:'0.0009002 g/cm³', discovered:'1898', state:'Gas',    electronegativity:'—',    radius:'38 pm',  desc:'Used in glowing advertising signs and laser technology.'},
  {n:11, sym:'Na', name:'Sodium',         mass:'22.990',   cat:'alkali',     group:1,  period:3, config:'[Ne] 3s¹',               melt:'97.72°C',  boil:'883°C',    density:'0.968 g/cm³',     discovered:'1807', state:'Solid',  electronegativity:'0.93', radius:'190 pm', desc:'A reactive metal that explodes on contact with water.'},
  {n:12, sym:'Mg', name:'Magnesium',      mass:'24.305',   cat:'alkaline',   group:2,  period:3, config:'[Ne] 3s²',               melt:'650°C',    boil:'1090°C',   density:'1.738 g/cm³',     discovered:'1755', state:'Solid',  electronegativity:'1.31', radius:'145 pm', desc:'A lightweight structural metal used in alloys and fireworks.'},
  {n:13, sym:'Al', name:'Aluminium',      mass:'26.982',   cat:'post-trans', group:13, period:3, config:'[Ne] 3s² 3p¹',           melt:'660.3°C',  boil:'2519°C',   density:'2.70 g/cm³',      discovered:'1825', state:'Solid',  electronegativity:'1.61', radius:'118 pm', desc:'The most abundant metal in Earth\'s crust; lightweight and corrosion-resistant.'},
  {n:14, sym:'Si', name:'Silicon',        mass:'28.086',   cat:'metalloid',  group:14, period:3, config:'[Ne] 3s² 3p²',           melt:'1414°C',   boil:'3265°C',   density:'2.33 g/cm³',      discovered:'1824', state:'Solid',  electronegativity:'1.90', radius:'111 pm', desc:'The foundation of modern electronics and semiconductors.'},
  {n:15, sym:'P',  name:'Phosphorus',     mass:'30.974',   cat:'nonmetal',   group:15, period:3, config:'[Ne] 3s² 3p³',           melt:'44.2°C',   boil:'280.5°C',  density:'1.82 g/cm³',      discovered:'1669', state:'Solid',  electronegativity:'2.19', radius:'98 pm',  desc:'Essential for DNA, RNA, and ATP; used in fertilizers.'},
  {n:16, sym:'S',  name:'Sulfur',         mass:'32.065',   cat:'nonmetal',   group:16, period:3, config:'[Ne] 3s² 3p⁴',           melt:'115.2°C',  boil:'444.6°C',  density:'2.07 g/cm³',      discovered:'Ancient',state:'Solid', electronegativity:'2.58', radius:'88 pm',  desc:'A yellow solid used in gunpowder, matches, and acid production.'},
  {n:17, sym:'Cl', name:'Chlorine',       mass:'35.453',   cat:'halogen',    group:17, period:3, config:'[Ne] 3s² 3p⁵',           melt:'-101.5°C', boil:'-34.05°C', density:'0.003214 g/cm³',  discovered:'1774', state:'Gas',    electronegativity:'3.16', radius:'79 pm',  desc:'Used in water purification and as a disinfectant.'},
  {n:18, sym:'Ar', name:'Argon',          mass:'39.948',   cat:'noble-gas',  group:18, period:3, config:'[Ne] 3s² 3p⁶',           melt:'-189.3°C', boil:'-185.8°C', density:'0.001784 g/cm³',  discovered:'1894', state:'Gas',    electronegativity:'—',    radius:'71 pm',  desc:'The third most abundant gas in Earth\'s atmosphere.'},
  {n:19, sym:'K',  name:'Potassium',      mass:'39.098',   cat:'alkali',     group:1,  period:4, config:'[Ar] 4s¹',               melt:'63.38°C',  boil:'759°C',    density:'0.862 g/cm³',     discovered:'1807', state:'Solid',  electronegativity:'0.82', radius:'243 pm', desc:'Essential for nerve function and found in bananas.'},
  {n:20, sym:'Ca', name:'Calcium',        mass:'40.078',   cat:'alkaline',   group:2,  period:4, config:'[Ar] 4s²',               melt:'842°C',    boil:'1484°C',   density:'1.55 g/cm³',      discovered:'1808', state:'Solid',  electronegativity:'1.00', radius:'194 pm', desc:'Essential for bone formation; most abundant mineral in the body.'},
  {n:21, sym:'Sc', name:'Scandium',       mass:'44.956',   cat:'transition', group:3,  period:4, config:'[Ar] 3d¹ 4s²',           melt:'1541°C',   boil:'2836°C',   density:'2.985 g/cm³',     discovered:'1879', state:'Solid',  electronegativity:'1.36', radius:'184 pm', desc:'A rare transition metal used in aerospace alloys.'},
  {n:22, sym:'Ti', name:'Titanium',       mass:'47.867',   cat:'transition', group:4,  period:4, config:'[Ar] 3d² 4s²',           melt:'1668°C',   boil:'3287°C',   density:'4.506 g/cm³',     discovered:'1791', state:'Solid',  electronegativity:'1.54', radius:'176 pm', desc:'Strong, lightweight metal used in aircraft and implants.'},
  {n:23, sym:'V',  name:'Vanadium',       mass:'50.942',   cat:'transition', group:5,  period:4, config:'[Ar] 3d³ 4s²',           melt:'1910°C',   boil:'3407°C',   density:'6.11 g/cm³',      discovered:'1801', state:'Solid',  electronegativity:'1.63', radius:'171 pm', desc:'Used in steel alloys and vanadium redox batteries.'},
  {n:24, sym:'Cr', name:'Chromium',       mass:'51.996',   cat:'transition', group:6,  period:4, config:'[Ar] 3d⁵ 4s¹',           melt:'1907°C',   boil:'2671°C',   density:'7.19 g/cm³',      discovered:'1797', state:'Solid',  electronegativity:'1.66', radius:'166 pm', desc:'Gives stainless steel its corrosion resistance and shine.'},
  {n:25, sym:'Mn', name:'Manganese',      mass:'54.938',   cat:'transition', group:7,  period:4, config:'[Ar] 3d⁵ 4s²',           melt:'1246°C',   boil:'2061°C',   density:'7.21 g/cm³',      discovered:'1774', state:'Solid',  electronegativity:'1.55', radius:'161 pm', desc:'Essential for steel production and enzyme function.'},
  {n:26, sym:'Fe', name:'Iron',           mass:'55.845',   cat:'transition', group:8,  period:4, config:'[Ar] 3d⁶ 4s²',           melt:'1538°C',   boil:'2861°C',   density:'7.874 g/cm³',     discovered:'Ancient',state:'Solid', electronegativity:'1.83', radius:'156 pm', desc:'The most used metal; core of Earth; essential in blood (hemoglobin).'},
  {n:27, sym:'Co', name:'Cobalt',         mass:'58.933',   cat:'transition', group:9,  period:4, config:'[Ar] 3d⁷ 4s²',           melt:'1495°C',   boil:'2927°C',   density:'8.90 g/cm³',      discovered:'1735', state:'Solid',  electronegativity:'1.88', radius:'152 pm', desc:'Used in lithium-ion batteries and blue pigments.'},
  {n:28, sym:'Ni', name:'Nickel',         mass:'58.693',   cat:'transition', group:10, period:4, config:'[Ar] 3d⁸ 4s²',           melt:'1455°C',   boil:'2913°C',   density:'8.908 g/cm³',     discovered:'1751', state:'Solid',  electronegativity:'1.91', radius:'149 pm', desc:'Used in coins, stainless steel, and rechargeable batteries.'},
  {n:29, sym:'Cu', name:'Copper',         mass:'63.546',   cat:'transition', group:11, period:4, config:'[Ar] 3d¹⁰ 4s¹',          melt:'1084.6°C', boil:'2562°C',   density:'8.96 g/cm³',      discovered:'Ancient',state:'Solid', electronegativity:'1.90', radius:'145 pm', desc:'An excellent electrical conductor used in wiring and plumbing.'},
  {n:30, sym:'Zn', name:'Zinc',           mass:'65.38',    cat:'transition', group:12, period:4, config:'[Ar] 3d¹⁰ 4s²',          melt:'419.5°C',  boil:'907°C',    density:'7.134 g/cm³',     discovered:'1746', state:'Solid',  electronegativity:'1.65', radius:'142 pm', desc:'Used to galvanize steel and essential for immune function.'},
  {n:31, sym:'Ga', name:'Gallium',        mass:'69.723',   cat:'post-trans', group:13, period:4, config:'[Ar] 3d¹⁰ 4s² 4p¹',      melt:'29.76°C',  boil:'2204°C',   density:'5.91 g/cm³',      discovered:'1875', state:'Solid',  electronegativity:'1.81', radius:'136 pm', desc:'Melts in your hand; used in semiconductors and LEDs.'},
  {n:32, sym:'Ge', name:'Germanium',      mass:'72.630',   cat:'metalloid',  group:14, period:4, config:'[Ar] 3d¹⁰ 4s² 4p²',      melt:'938.3°C',  boil:'2833°C',   density:'5.323 g/cm³',     discovered:'1886', state:'Solid',  electronegativity:'2.01', radius:'125 pm', desc:'A semiconductor used in transistors and fiber optics.'},
  {n:33, sym:'As', name:'Arsenic',        mass:'74.922',   cat:'metalloid',  group:15, period:4, config:'[Ar] 3d¹⁰ 4s² 4p³',      melt:'817°C',    boil:'614°C',    density:'5.727 g/cm³',     discovered:'Ancient',state:'Solid', electronegativity:'2.18', radius:'114 pm', desc:'A toxic metalloid historically used as a poison.'},
  {n:34, sym:'Se', name:'Selenium',       mass:'78.971',   cat:'nonmetal',   group:16, period:4, config:'[Ar] 3d¹⁰ 4s² 4p⁴',      melt:'220.8°C',  boil:'685°C',    density:'4.81 g/cm³',      discovered:'1817', state:'Solid',  electronegativity:'2.55', radius:'103 pm', desc:'Essential trace element; used in photocopiers and solar cells.'},
  {n:35, sym:'Br', name:'Bromine',        mass:'79.904',   cat:'halogen',    group:17, period:4, config:'[Ar] 3d¹⁰ 4s² 4p⁵',      melt:'-7.2°C',   boil:'58.8°C',   density:'3.122 g/cm³',     discovered:'1826', state:'Liquid', electronegativity:'2.96', radius:'94 pm',  desc:'One of two elements liquid at room temperature.'},
  {n:36, sym:'Kr', name:'Krypton',        mass:'83.798',   cat:'noble-gas',  group:18, period:4, config:'[Ar] 3d¹⁰ 4s² 4p⁶',      melt:'-157.4°C', boil:'-153.4°C', density:'0.003749 g/cm³',  discovered:'1898', state:'Gas',    electronegativity:'3.00', radius:'88 pm',  desc:'Used in high-performance lights and lasers.'},
  {n:37, sym:'Rb', name:'Rubidium',       mass:'85.468',   cat:'alkali',     group:1,  period:5, config:'[Kr] 5s¹',               melt:'39.31°C',  boil:'688°C',    density:'1.532 g/cm³',     discovered:'1861', state:'Solid',  electronegativity:'0.82', radius:'265 pm', desc:'A soft, silvery metal used in atomic clocks.'},
  {n:38, sym:'Sr', name:'Strontium',      mass:'87.62',    cat:'alkaline',   group:2,  period:5, config:'[Kr] 5s²',               melt:'777°C',    boil:'1382°C',   density:'2.64 g/cm³',      discovered:'1790', state:'Solid',  electronegativity:'0.95', radius:'219 pm', desc:'Gives fireworks and flares their brilliant red color.'},
  {n:39, sym:'Y',  name:'Yttrium',        mass:'88.906',   cat:'transition', group:3,  period:5, config:'[Kr] 4d¹ 5s²',           melt:'1526°C',   boil:'3336°C',   density:'4.472 g/cm³',     discovered:'1794', state:'Solid',  electronegativity:'1.22', radius:'212 pm', desc:'Used in LED phosphors and superconductors.'},
  {n:40, sym:'Zr', name:'Zirconium',      mass:'91.224',   cat:'transition', group:4,  period:5, config:'[Kr] 4d² 5s²',           melt:'1854°C',   boil:'4409°C',   density:'6.52 g/cm³',      discovered:'1789', state:'Solid',  electronegativity:'1.33', radius:'206 pm', desc:'Extremely corrosion-resistant; used in nuclear reactors.'},
  {n:41, sym:'Nb', name:'Niobium',        mass:'92.906',   cat:'transition', group:5,  period:5, config:'[Kr] 4d⁴ 5s¹',           melt:'2477°C',   boil:'4741°C',   density:'8.57 g/cm³',      discovered:'1801', state:'Solid',  electronegativity:'1.6',  radius:'198 pm', desc:'Used in superconducting magnets and high-strength steel.'},
  {n:42, sym:'Mo', name:'Molybdenum',     mass:'95.96',    cat:'transition', group:6,  period:5, config:'[Kr] 4d⁵ 5s¹',           melt:'2622°C',   boil:'4639°C',   density:'10.28 g/cm³',     discovered:'1781', state:'Solid',  electronegativity:'2.16', radius:'190 pm', desc:'Has one of the highest melting points of all metals.'},
  {n:43, sym:'Tc', name:'Technetium',     mass:'(98)',     cat:'transition', group:7,  period:5, config:'[Kr] 4d⁵ 5s²',           melt:'2157°C',   boil:'4265°C',   density:'11.5 g/cm³',      discovered:'1937', state:'Solid',  electronegativity:'1.9',  radius:'183 pm', desc:'The first artificially produced element; used in medical imaging.'},
  {n:44, sym:'Ru', name:'Ruthenium',      mass:'101.07',   cat:'transition', group:8,  period:5, config:'[Kr] 4d⁷ 5s¹',           melt:'2333°C',   boil:'4150°C',   density:'12.45 g/cm³',     discovered:'1844', state:'Solid',  electronegativity:'2.2',  radius:'178 pm', desc:'A rare platinum group metal used in electrical contacts.'},
  {n:45, sym:'Rh', name:'Rhodium',        mass:'102.906',  cat:'transition', group:9,  period:5, config:'[Kr] 4d⁸ 5s¹',           melt:'1964°C',   boil:'3695°C',   density:'12.41 g/cm³',     discovered:'1803', state:'Solid',  electronegativity:'2.28', radius:'173 pm', desc:'One of the rarest metals; used in catalytic converters.'},
  {n:46, sym:'Pd', name:'Palladium',      mass:'106.42',   cat:'transition', group:10, period:5, config:'[Kr] 4d¹⁰',              melt:'1554.9°C', boil:'2963°C',   density:'12.023 g/cm³',    discovered:'1803', state:'Solid',  electronegativity:'2.20', radius:'169 pm', desc:'Used in catalytic converters and hydrogen purification.'},
  {n:47, sym:'Ag', name:'Silver',         mass:'107.868',  cat:'transition', group:11, period:5, config:'[Kr] 4d¹⁰ 5s¹',          melt:'961.8°C',  boil:'2162°C',   density:'10.49 g/cm³',     discovered:'Ancient',state:'Solid', electronegativity:'1.93', radius:'165 pm', desc:'The best electrical conductor; used in jewelry and photography.'},
  {n:48, sym:'Cd', name:'Cadmium',        mass:'112.411',  cat:'transition', group:12, period:5, config:'[Kr] 4d¹⁰ 5s²',          melt:'321.1°C',  boil:'767°C',    density:'8.65 g/cm³',      discovered:'1817', state:'Solid',  electronegativity:'1.69', radius:'161 pm', desc:'Toxic heavy metal used in rechargeable NiCd batteries.'},
  {n:49, sym:'In', name:'Indium',         mass:'114.818',  cat:'post-trans', group:13, period:5, config:'[Kr] 4d¹⁰ 5s² 5p¹',      melt:'156.6°C',  boil:'2072°C',   density:'7.31 g/cm³',      discovered:'1863', state:'Solid',  electronegativity:'1.78', radius:'156 pm', desc:'Used in touchscreens (ITO) and flat panel displays.'},
  {n:50, sym:'Sn', name:'Tin',            mass:'118.710',  cat:'post-trans', group:14, period:5, config:'[Kr] 4d¹⁰ 5s² 5p²',      melt:'231.9°C',  boil:'2602°C',   density:'7.287 g/cm³',     discovered:'Ancient',state:'Solid', electronegativity:'1.96', radius:'145 pm', desc:'Used in solder, tin cans, and bronze alloys.'},
  {n:51, sym:'Sb', name:'Antimony',       mass:'121.760',  cat:'metalloid',  group:15, period:5, config:'[Kr] 4d¹⁰ 5s² 5p³',      melt:'630.6°C',  boil:'1587°C',   density:'6.685 g/cm³',     discovered:'Ancient',state:'Solid', electronegativity:'2.05', radius:'133 pm', desc:'Used in flame retardants and semiconductor devices.'},
  {n:52, sym:'Te', name:'Tellurium',      mass:'127.60',   cat:'metalloid',  group:16, period:5, config:'[Kr] 4d¹⁰ 5s² 5p⁴',      melt:'449.5°C',  boil:'988°C',    density:'6.232 g/cm³',     discovered:'1782', state:'Solid',  electronegativity:'2.1',  radius:'123 pm', desc:'Used in solar panels and as a semiconductor.'},
  {n:53, sym:'I',  name:'Iodine',         mass:'126.904',  cat:'halogen',    group:17, period:5, config:'[Kr] 4d¹⁰ 5s² 5p⁵',      melt:'113.7°C',  boil:'184.4°C',  density:'4.93 g/cm³',      discovered:'1811', state:'Solid',  electronegativity:'2.66', radius:'115 pm', desc:'Essential for thyroid hormones; used as a disinfectant.'},
  {n:54, sym:'Xe', name:'Xenon',          mass:'131.293',  cat:'noble-gas',  group:18, period:5, config:'[Kr] 4d¹⁰ 5s² 5p⁶',      melt:'-111.8°C', boil:'-108.1°C', density:'0.005887 g/cm³',  discovered:'1898', state:'Gas',    electronegativity:'2.60', radius:'108 pm', desc:'Used in flash lamps, ion thrusters, and anesthesia.'},
  {n:55, sym:'Cs', name:'Caesium',        mass:'132.905',  cat:'alkali',     group:1,  period:6, config:'[Xe] 6s¹',               melt:'28.44°C',  boil:'671°C',    density:'1.873 g/cm³',     discovered:'1860', state:'Solid',  electronegativity:'0.79', radius:'298 pm', desc:'Used in atomic clocks that define the SI second.'},
  {n:56, sym:'Ba', name:'Barium',         mass:'137.327',  cat:'alkaline',   group:2,  period:6, config:'[Xe] 6s²',               melt:'727°C',    boil:'1845°C',   density:'3.51 g/cm³',      discovered:'1808', state:'Solid',  electronegativity:'0.89', radius:'253 pm', desc:'Used in X-ray imaging contrast agents and fireworks.'},
  {n:57, sym:'La', name:'Lanthanum',      mass:'138.905',  cat:'lanthanide', group:3,  period:6, config:'[Xe] 5d¹ 6s²',           melt:'920°C',    boil:'3464°C',   density:'6.162 g/cm³',     discovered:'1839', state:'Solid',  electronegativity:'1.10', radius:'195 pm', desc:'First lanthanide; used in camera lenses and hybrid batteries.'},
  {n:58, sym:'Ce', name:'Cerium',         mass:'140.116',  cat:'lanthanide', group:3,  period:6, config:'[Xe] 4f¹ 5d¹ 6s²',       melt:'798°C',    boil:'3443°C',   density:'6.770 g/cm³',     discovered:'1803', state:'Solid',  electronegativity:'1.12', radius:'185 pm', desc:'Most abundant lanthanide; used in catalytic converters.'},
  {n:59, sym:'Pr', name:'Praseodymium',   mass:'140.908',  cat:'lanthanide', group:3,  period:6, config:'[Xe] 4f³ 6s²',           melt:'931°C',    boil:'3520°C',   density:'6.77 g/cm³',      discovered:'1885', state:'Solid',  electronegativity:'1.13', radius:'185 pm', desc:'Used in high-strength magnets and aircraft engines.'},
  {n:60, sym:'Nd', name:'Neodymium',      mass:'144.242',  cat:'lanthanide', group:3,  period:6, config:'[Xe] 4f⁴ 6s²',           melt:'1024°C',   boil:'3074°C',   density:'7.01 g/cm³',      discovered:'1885', state:'Solid',  electronegativity:'1.14', radius:'185 pm', desc:'Makes the strongest permanent magnets in the world.'},
  {n:61, sym:'Pm', name:'Promethium',     mass:'(145)',    cat:'lanthanide', group:3,  period:6, config:'[Xe] 4f⁵ 6s²',           melt:'1042°C',   boil:'3000°C',   density:'7.26 g/cm³',      discovered:'1945', state:'Solid',  electronegativity:'1.13', radius:'185 pm', desc:'Radioactive; used in nuclear batteries.'},
  {n:62, sym:'Sm', name:'Samarium',       mass:'150.36',   cat:'lanthanide', group:3,  period:6, config:'[Xe] 4f⁶ 6s²',           melt:'1072°C',   boil:'1794°C',   density:'7.52 g/cm³',      discovered:'1879', state:'Solid',  electronegativity:'1.17', radius:'185 pm', desc:'Used in powerful SmCo permanent magnets.'},
  {n:63, sym:'Eu', name:'Europium',       mass:'151.964',  cat:'lanthanide', group:3,  period:6, config:'[Xe] 4f⁷ 6s²',           melt:'826°C',    boil:'1529°C',   density:'5.244 g/cm³',     discovered:'1901', state:'Solid',  electronegativity:'1.2',  radius:'185 pm', desc:'Provides red and blue phosphors in TV screens.'},
  {n:64, sym:'Gd', name:'Gadolinium',     mass:'157.25',   cat:'lanthanide', group:3,  period:6, config:'[Xe] 4f⁷ 5d¹ 6s²',       melt:'1312°C',   boil:'3250°C',   density:'7.90 g/cm³',      discovered:'1880', state:'Solid',  electronegativity:'1.20', radius:'180 pm', desc:'Used as MRI contrast agent and in nuclear reactors.'},
  {n:65, sym:'Tb', name:'Terbium',        mass:'158.925',  cat:'lanthanide', group:3,  period:6, config:'[Xe] 4f⁹ 6s²',           melt:'1356°C',   boil:'3230°C',   density:'8.23 g/cm³',      discovered:'1843', state:'Solid',  electronegativity:'1.2',  radius:'175 pm', desc:'Used in green phosphors and solid-state devices.'},
  {n:66, sym:'Dy', name:'Dysprosium',     mass:'162.500',  cat:'lanthanide', group:3,  period:6, config:'[Xe] 4f¹⁰ 6s²',          melt:'1407°C',   boil:'2567°C',   density:'8.540 g/cm³',     discovered:'1886', state:'Solid',  electronegativity:'1.22', radius:'175 pm', desc:'Critical for high-performance electric vehicle motors.'},
  {n:67, sym:'Ho', name:'Holmium',        mass:'164.930',  cat:'lanthanide', group:3,  period:6, config:'[Xe] 4f¹¹ 6s²',          melt:'1461°C',   boil:'2720°C',   density:'8.79 g/cm³',      discovered:'1878', state:'Solid',  electronegativity:'1.23', radius:'175 pm', desc:'Has the highest magnetic moment of any natural element.'},
  {n:68, sym:'Er', name:'Erbium',         mass:'167.259',  cat:'lanthanide', group:3,  period:6, config:'[Xe] 4f¹² 6s²',          melt:'1529°C',   boil:'2868°C',   density:'9.066 g/cm³',     discovered:'1842', state:'Solid',  electronegativity:'1.24', radius:'175 pm', desc:'Used in fiber optic amplifiers and pink glass.'},
  {n:69, sym:'Tm', name:'Thulium',        mass:'168.934',  cat:'lanthanide', group:3,  period:6, config:'[Xe] 4f¹³ 6s²',          melt:'1545°C',   boil:'1950°C',   density:'9.32 g/cm³',      discovered:'1879', state:'Solid',  electronegativity:'1.25', radius:'175 pm', desc:'The rarest stable lanthanide; used in portable X-ray devices.'},
  {n:70, sym:'Yb', name:'Ytterbium',      mass:'173.045',  cat:'lanthanide', group:3,  period:6, config:'[Xe] 4f¹⁴ 6s²',          melt:'819°C',    boil:'1196°C',   density:'6.90 g/cm³',      discovered:'1878', state:'Solid',  electronegativity:'1.1',  radius:'175 pm', desc:'Used in high-precision atomic clocks.'},
  {n:71, sym:'Lu', name:'Lutetium',       mass:'174.967',  cat:'lanthanide', group:3,  period:6, config:'[Xe] 4f¹⁴ 5d¹ 6s²',      melt:'1652°C',   boil:'3402°C',   density:'9.841 g/cm³',     discovered:'1907', state:'Solid',  electronegativity:'1.27', radius:'175 pm', desc:'The densest lanthanide; used in PET scan detectors.'},
  {n:72, sym:'Hf', name:'Hafnium',        mass:'178.49',   cat:'transition', group:4,  period:6, config:'[Xe] 4f¹⁴ 5d² 6s²',      melt:'2233°C',   boil:'4603°C',   density:'13.31 g/cm³',     discovered:'1923', state:'Solid',  electronegativity:'1.3',  radius:'187 pm', desc:'Used in nuclear control rods and microchip gates.'},
  {n:73, sym:'Ta', name:'Tantalum',       mass:'180.948',  cat:'transition', group:5,  period:6, config:'[Xe] 4f¹⁴ 5d³ 6s²',      melt:'3017°C',   boil:'5455°C',   density:'16.65 g/cm³',     discovered:'1802', state:'Solid',  electronegativity:'1.5',  radius:'180 pm', desc:'Biocompatible; used in surgical implants and capacitors.'},
  {n:74, sym:'W',  name:'Tungsten',       mass:'183.84',   cat:'transition', group:6,  period:6, config:'[Xe] 4f¹⁴ 5d⁴ 6s²',      melt:'3422°C',   boil:'5555°C',   density:'19.25 g/cm³',     discovered:'1783', state:'Solid',  electronegativity:'2.36', radius:'170 pm', desc:'Highest melting point of all metals; used in light bulb filaments.'},
  {n:75, sym:'Re', name:'Rhenium',        mass:'186.207',  cat:'transition', group:7,  period:6, config:'[Xe] 4f¹⁴ 5d⁵ 6s²',      melt:'3186°C',   boil:'5596°C',   density:'21.02 g/cm³',     discovered:'1925', state:'Solid',  electronegativity:'1.9',  radius:'163 pm', desc:'One of the rarest elements; used in jet engine alloys.'},
  {n:76, sym:'Os', name:'Osmium',         mass:'190.23',   cat:'transition', group:8,  period:6, config:'[Xe] 4f¹⁴ 5d⁶ 6s²',      melt:'3033°C',   boil:'5012°C',   density:'22.59 g/cm³',     discovered:'1803', state:'Solid',  electronegativity:'2.2',  radius:'135 pm', desc:'The densest naturally occurring element.'},
  {n:77, sym:'Ir', name:'Iridium',        mass:'192.217',  cat:'transition', group:9,  period:6, config:'[Xe] 4f¹⁴ 5d⁷ 6s²',      melt:'2446°C',   boil:'4428°C',   density:'22.56 g/cm³',     discovered:'1803', state:'Solid',  electronegativity:'2.20', radius:'135 pm', desc:'The most corrosion-resistant metal; evidence of asteroid impact.'},
  {n:78, sym:'Pt', name:'Platinum',       mass:'195.084',  cat:'transition', group:10, period:6, config:'[Xe] 4f¹⁴ 5d⁹ 6s¹',      melt:'1768.3°C', boil:'3825°C',   density:'21.45 g/cm³',     discovered:'1735', state:'Solid',  electronegativity:'2.28', radius:'135 pm', desc:'Precious metal used in catalytic converters and jewelry.'},
  {n:79, sym:'Au', name:'Gold',           mass:'196.967',  cat:'transition', group:11, period:6, config:'[Xe] 4f¹⁴ 5d¹⁰ 6s¹',     melt:'1064.2°C', boil:'2856°C',   density:'19.30 g/cm³',     discovered:'Ancient',state:'Solid', electronegativity:'2.54', radius:'135 pm', desc:'The most malleable metal; symbol of wealth since ancient times.'},
  {n:80, sym:'Hg', name:'Mercury',        mass:'200.592',  cat:'transition', group:12, period:6, config:'[Xe] 4f¹⁴ 5d¹⁰ 6s²',     melt:'-38.83°C', boil:'356.7°C',  density:'13.534 g/cm³',    discovered:'Ancient',state:'Liquid',electronegativity:'2.00', radius:'150 pm', desc:'The only metal liquid at room temperature; used in thermometers.'},
  {n:81, sym:'Tl', name:'Thallium',       mass:'204.383',  cat:'post-trans', group:13, period:6, config:'[Xe] 4f¹⁴ 5d¹⁰ 6s² 6p¹', melt:'304°C',    boil:'1473°C',   density:'11.85 g/cm³',     discovered:'1861', state:'Solid',  electronegativity:'1.62', radius:'190 pm', desc:'Highly toxic; used in heart imaging and semiconductors.'},
  {n:82, sym:'Pb', name:'Lead',           mass:'207.2',    cat:'post-trans', group:14, period:6, config:'[Xe] 4f¹⁴ 5d¹⁰ 6s² 6p²', melt:'327.5°C',  boil:'1749°C',   density:'11.34 g/cm³',     discovered:'Ancient',state:'Solid', electronegativity:'2.33', radius:'180 pm', desc:'Dense toxic metal; used in batteries and radiation shielding.'},
  {n:83, sym:'Bi', name:'Bismuth',        mass:'208.980',  cat:'post-trans', group:15, period:6, config:'[Xe] 4f¹⁴ 5d¹⁰ 6s² 6p³', melt:'271.5°C',  boil:'1564°C',   density:'9.807 g/cm³',     discovered:'1753', state:'Solid',  electronegativity:'2.02', radius:'160 pm', desc:'Forms beautiful iridescent crystals; used in pharmaceuticals.'},
  {n:84, sym:'Po', name:'Polonium',       mass:'(209)',    cat:'post-trans', group:16, period:6, config:'[Xe] 4f¹⁴ 5d¹⁰ 6s² 6p⁴', melt:'254°C',    boil:'962°C',    density:'9.32 g/cm³',      discovered:'1898', state:'Solid',  electronegativity:'2.0',  radius:'190 pm', desc:'Highly radioactive; discovered by Marie Curie.'},
  {n:85, sym:'At', name:'Astatine',       mass:'(210)',    cat:'halogen',    group:17, period:6, config:'[Xe] 4f¹⁴ 5d¹⁰ 6s² 6p⁵', melt:'302°C',    boil:'337°C',    density:'~7 g/cm³',        discovered:'1940', state:'Solid',  electronegativity:'2.2',  radius:'127 pm', desc:'The rarest naturally occurring element on Earth.'},
  {n:86, sym:'Rn', name:'Radon',          mass:'(222)',    cat:'noble-gas',  group:18, period:6, config:'[Xe] 4f¹⁴ 5d¹⁰ 6s² 6p⁶', melt:'-71°C',    boil:'-61.7°C',  density:'0.00973 g/cm³',   discovered:'1900', state:'Gas',    electronegativity:'2.2',  radius:'120 pm', desc:'A radioactive gas that can accumulate in buildings.'},
  {n:87, sym:'Fr', name:'Francium',       mass:'(223)',    cat:'alkali',     group:1,  period:7, config:'[Rn] 7s¹',               melt:'27°C',     boil:'677°C',    density:'~1.87 g/cm³',     discovered:'1939', state:'Solid',  electronegativity:'0.7',  radius:'348 pm', desc:'The second rarest naturally occurring element; highly radioactive.'},
  {n:88, sym:'Ra', name:'Radium',         mass:'(226)',    cat:'alkaline',   group:2,  period:7, config:'[Rn] 7s²',               melt:'700°C',    boil:'1737°C',   density:'5.5 g/cm³',       discovered:'1898', state:'Solid',  electronegativity:'0.9',  radius:'283 pm', desc:'Radioactive; discovered by Marie Curie; once used in watch dials.'},
  {n:89, sym:'Ac', name:'Actinium',       mass:'(227)',    cat:'actinide',   group:3,  period:7, config:'[Rn] 6d¹ 7s²',           melt:'1050°C',   boil:'3197°C',   density:'10.07 g/cm³',     discovered:'1899', state:'Solid',  electronegativity:'1.1',  radius:'195 pm', desc:'First actinide; glows blue from radioactive decay.'},
  {n:90, sym:'Th', name:'Thorium',        mass:'232.038',  cat:'actinide',   group:3,  period:7, config:'[Rn] 6d² 7s²',           melt:'1750°C',   boil:'4788°C',   density:'11.72 g/cm³',     discovered:'1829', state:'Solid',  electronegativity:'1.3',  radius:'180 pm', desc:'A potential nuclear fuel more abundant than uranium.'},
  {n:91, sym:'Pa', name:'Protactinium',   mass:'231.036',  cat:'actinide',   group:3,  period:7, config:'[Rn] 5f² 6d¹ 7s²',       melt:'1572°C',   boil:'4000°C',   density:'15.37 g/cm³',     discovered:'1913', state:'Solid',  electronegativity:'1.5',  radius:'180 pm', desc:'A rare, toxic, radioactive actinide with no commercial uses.'},
  {n:92, sym:'U',  name:'Uranium',        mass:'238.029',  cat:'actinide',   group:3,  period:7, config:'[Rn] 5f³ 6d¹ 7s²',       melt:'1132°C',   boil:'4131°C',   density:'19.05 g/cm³',     discovered:'1789', state:'Solid',  electronegativity:'1.38', radius:'175 pm', desc:'Used as nuclear fuel; its fission powers nuclear reactors.'},
  {n:93, sym:'Np', name:'Neptunium',      mass:'(237)',    cat:'actinide',   group:3,  period:7, config:'[Rn] 5f⁴ 6d¹ 7s²',       melt:'637°C',    boil:'4000°C',   density:'20.45 g/cm³',     discovered:'1940', state:'Solid',  electronegativity:'1.36', radius:'175 pm', desc:'First transuranic element; produced in nuclear reactors.'},
  {n:94, sym:'Pu', name:'Plutonium',      mass:'(244)',    cat:'actinide',   group:3,  period:7, config:'[Rn] 5f⁶ 7s²',           melt:'639.4°C',  boil:'3228°C',   density:'19.84 g/cm³',     discovered:'1940', state:'Solid',  electronegativity:'1.28', radius:'175 pm', desc:'Used in nuclear weapons and as reactor fuel.'},
  {n:95, sym:'Am', name:'Americium',      mass:'(243)',    cat:'actinide',   group:3,  period:7, config:'[Rn] 5f⁷ 7s²',           melt:'1176°C',   boil:'2607°C',   density:'13.69 g/cm³',     discovered:'1944', state:'Solid',  electronegativity:'1.3',  radius:'175 pm', desc:'Used in smoke detectors; the only synthetic element in homes.'},
  {n:96, sym:'Cm', name:'Curium',         mass:'(247)',    cat:'actinide',   group:3,  period:7, config:'[Rn] 5f⁷ 6d¹ 7s²',       melt:'1345°C',   boil:'3110°C',   density:'13.51 g/cm³',     discovered:'1944', state:'Solid',  electronegativity:'1.3',  radius:'175 pm', desc:'Named after Marie and Pierre Curie.'},
  {n:97, sym:'Bk', name:'Berkelium',      mass:'(247)',    cat:'actinide',   group:3,  period:7, config:'[Rn] 5f⁹ 7s²',           melt:'986°C',    boil:'2627°C',   density:'14.78 g/cm³',     discovered:'1949', state:'Solid',  electronegativity:'1.3',  radius:'170 pm', desc:'Named after Berkeley, California where it was synthesized.'},
  {n:98, sym:'Cf', name:'Californium',    mass:'(251)',    cat:'actinide',   group:3,  period:7, config:'[Rn] 5f¹⁰ 7s²',          melt:'900°C',    boil:'1470°C',   density:'15.1 g/cm³',      discovered:'1950', state:'Solid',  electronegativity:'1.3',  radius:'170 pm', desc:'Used in nuclear start-up neutron sources.'},
  {n:99, sym:'Es', name:'Einsteinium',    mass:'(252)',    cat:'actinide',   group:3,  period:7, config:'[Rn] 5f¹¹ 7s²',          melt:'860°C',    boil:'996°C',    density:'8.84 g/cm³',      discovered:'1952', state:'Solid',  electronegativity:'1.3',  radius:'170 pm', desc:'Named after Albert Einstein; created in nuclear explosions.'},
  {n:100,sym:'Fm', name:'Fermium',        mass:'(257)',    cat:'actinide',   group:3,  period:7, config:'[Rn] 5f¹² 7s²',          melt:'1527°C',   boil:'—',        density:'~30 g/cm³',       discovered:'1952', state:'Solid',  electronegativity:'1.3',  radius:'—',      desc:'Named after Enrico Fermi; produced only in nuclear reactors.'},
  {n:101,sym:'Md', name:'Mendelevium',    mass:'(258)',    cat:'actinide',   group:3,  period:7, config:'[Rn] 5f¹³ 7s²',          melt:'827°C',    boil:'—',        density:'—',               discovered:'1955', state:'Solid',  electronegativity:'1.3',  radius:'—',      desc:'Named after Dmitri Mendeleev, creator of the periodic table.'},
  {n:102,sym:'No', name:'Nobelium',       mass:'(259)',    cat:'actinide',   group:3,  period:7, config:'[Rn] 5f¹⁴ 7s²',          melt:'827°C',    boil:'—',        density:'—',               discovered:'1958', state:'Solid',  electronegativity:'1.3',  radius:'—',      desc:'Named after Alfred Nobel; extremely short-lived.'},
  {n:103,sym:'Lr', name:'Lawrencium',     mass:'(266)',    cat:'actinide',   group:3,  period:7, config:'[Rn] 5f¹⁴ 7s² 7p¹',      melt:'1627°C',   boil:'—',        density:'—',               discovered:'1961', state:'Solid',  electronegativity:'1.3',  radius:'—',      desc:'Last actinide; named after Ernest Lawrence.'},
  {n:104,sym:'Rf', name:'Rutherfordium',  mass:'(267)',    cat:'transition', group:4,  period:7, config:'[Rn] 5f¹⁴ 6d² 7s²',      melt:'2100°C',   boil:'5500°C',   density:'23.2 g/cm³',      discovered:'1969', state:'Solid',  electronegativity:'—',    radius:'—',      desc:'A superheavy synthetic element; extremely short-lived.'},
  {n:105,sym:'Db', name:'Dubnium',        mass:'(268)',    cat:'transition', group:5,  period:7, config:'[Rn] 5f¹⁴ 6d³ 7s²',      melt:'—',        boil:'—',        density:'29.3 g/cm³',      discovered:'1970', state:'Solid',  electronegativity:'—',    radius:'—',      desc:'Named after Dubna, Russia; only a few atoms ever produced.'},
  {n:106,sym:'Sg', name:'Seaborgium',     mass:'(271)',    cat:'transition', group:6,  period:7, config:'[Rn] 5f¹⁴ 6d⁴ 7s²',      melt:'—',        boil:'—',        density:'35.0 g/cm³',      discovered:'1974', state:'Solid',  electronegativity:'—',    radius:'—',      desc:'Named after Glenn Seaborg; half-life of seconds.'},
  {n:107,sym:'Bh', name:'Bohrium',        mass:'(272)',    cat:'transition', group:7,  period:7, config:'[Rn] 5f¹⁴ 6d⁵ 7s²',      melt:'—',        boil:'—',        density:'37.1 g/cm³',      discovered:'1981', state:'Solid',  electronegativity:'—',    radius:'—',      desc:'Named after Niels Bohr; extremely radioactive.'},
  {n:108,sym:'Hs', name:'Hassium',        mass:'(277)',    cat:'transition', group:8,  period:7, config:'[Rn] 5f¹⁴ 6d⁶ 7s²',      melt:'—',        boil:'—',        density:'41.0 g/cm³',      discovered:'1984', state:'Solid',  electronegativity:'—',    radius:'—',      desc:'Named after Hesse, Germany; only atoms produced.'},
  {n:109,sym:'Mt', name:'Meitnerium',     mass:'(276)',    cat:'unknown',    group:9,  period:7, config:'[Rn] 5f¹⁴ 6d⁷ 7s²',      melt:'—',        boil:'—',        density:'37.4 g/cm³',      discovered:'1982', state:'Solid',  electronegativity:'—',    radius:'—',      desc:'Named after Lise Meitner, physicist.'},
  {n:110,sym:'Ds', name:'Darmstadtium',   mass:'(281)',    cat:'unknown',    group:10, period:7, config:'[Rn] 5f¹⁴ 6d⁹ 7s¹',      melt:'—',        boil:'—',        density:'34.8 g/cm³',      discovered:'1994', state:'Solid',  electronegativity:'—',    radius:'—',      desc:'Named after Darmstadt, Germany.'},
  {n:111,sym:'Rg', name:'Roentgenium',    mass:'(282)',    cat:'unknown',    group:11, period:7, config:'[Rn] 5f¹⁴ 6d¹⁰ 7s¹',     melt:'—',        boil:'—',        density:'28.7 g/cm³',      discovered:'1994', state:'Solid',  electronegativity:'—',    radius:'—',      desc:'Named after Wilhelm Röntgen, discoverer of X-rays.'},
  {n:112,sym:'Cn', name:'Copernicium',    mass:'(285)',    cat:'unknown',    group:12, period:7, config:'[Rn] 5f¹⁴ 6d¹⁰ 7s²',     melt:'—',        boil:'—',        density:'23.7 g/cm³',      discovered:'1996', state:'Gas',    electronegativity:'—',    radius:'—',      desc:'Named after Nicolaus Copernicus.'},
  {n:113,sym:'Nh', name:'Nihonium',       mass:'(286)',    cat:'unknown',    group:13, period:7, config:'[Rn] 5f¹⁴ 6d¹⁰ 7s² 7p¹', melt:'—',        boil:'—',        density:'16 g/cm³',        discovered:'2004', state:'Solid',  electronegativity:'—',    radius:'—',      desc:'Named after Japan (Nihon); discovered by Japanese team.'},
  {n:114,sym:'Fl', name:'Flerovium',      mass:'(289)',    cat:'unknown',    group:14, period:7, config:'[Rn] 5f¹⁴ 6d¹⁰ 7s² 7p²', melt:'—',        boil:'—',        density:'14 g/cm³',        discovered:'1999', state:'Solid',  electronegativity:'—',    radius:'—',      desc:'Named after Flerov Laboratory of Nuclear Reactions.'},
  {n:115,sym:'Mc', name:'Moscovium',      mass:'(290)',    cat:'unknown',    group:15, period:7, config:'[Rn] 5f¹⁴ 6d¹⁰ 7s² 7p³', melt:'—',        boil:'—',        density:'13.5 g/cm³',      discovered:'2003', state:'Solid',  electronegativity:'—',    radius:'—',      desc:'Named after Moscow Oblast, Russia.'},
  {n:116,sym:'Lv', name:'Livermorium',    mass:'(293)',    cat:'unknown',    group:16, period:7, config:'[Rn] 5f¹⁴ 6d¹⁰ 7s² 7p⁴', melt:'—',        boil:'—',        density:'12.9 g/cm³',      discovered:'2000', state:'Solid',  electronegativity:'—',    radius:'—',      desc:'Named after Lawrence Livermore National Laboratory.'},
  {n:117,sym:'Ts', name:'Tennessine',     mass:'(294)',    cat:'unknown',    group:17, period:7, config:'[Rn] 5f¹⁴ 6d¹⁰ 7s² 7p⁵', melt:'—',        boil:'—',        density:'7.17 g/cm³',      discovered:'2010', state:'Solid',  electronegativity:'—',    radius:'—',      desc:'Named after Tennessee; last of the halogens group.'},
  {n:118,sym:'Og', name:'Oganesson',      mass:'(294)',    cat:'unknown',    group:18, period:7, config:'[Rn] 5f¹⁴ 6d¹⁰ 7s² 7p⁶', melt:'—',        boil:'—',        density:'4.95 g/cm³',      discovered:'2002', state:'Solid',  electronegativity:'—',    radius:'—',      desc:'The heaviest known element; named after Yuri Oganessian.'},
];

const PT_CAT_COLORS = {
  'alkali':     '#ef4444',
  'alkaline':   '#f97316',
  'transition': '#eab308',
  'post-trans': '#14b8a6',
  'metalloid':  '#22c55e',
  'nonmetal':   '#3b82f6',
  'halogen':    '#10b981',
  'noble-gas':  '#8b5cf6',
  'lanthanide': '#ec4899',
  'actinide':   '#fb923c',
  'unknown':    '#64748b',
};

const PT_CAT_LABELS = {
  'alkali':     'Alkali Metal',
  'alkaline':   'Alkaline Earth',
  'transition': 'Transition Metal',
  'post-trans': 'Post-Transition',
  'metalloid':  'Metalloid',
  'nonmetal':   'Nonmetal',
  'halogen':    'Halogen',
  'noble-gas':  'Noble Gas',
  'lanthanide': 'Lanthanide',
  'actinide':   'Actinide',
  'unknown':    'Unknown',
};

// Grid positions [col, row] for each element (1-indexed)
const PT_POSITIONS = {
  1:[1,1],  2:[18,1],
  3:[1,2],  4:[2,2],  5:[13,2], 6:[14,2], 7:[15,2], 8:[16,2], 9:[17,2], 10:[18,2],
  11:[1,3], 12:[2,3], 13:[13,3],14:[14,3],15:[15,3],16:[16,3],17:[17,3],18:[18,3],
  19:[1,4], 20:[2,4], 21:[3,4], 22:[4,4], 23:[5,4], 24:[6,4], 25:[7,4], 26:[8,4], 27:[9,4], 28:[10,4],29:[11,4],30:[12,4],31:[13,4],32:[14,4],33:[15,4],34:[16,4],35:[17,4],36:[18,4],
  37:[1,5], 38:[2,5], 39:[3,5], 40:[4,5], 41:[5,5], 42:[6,5], 43:[7,5], 44:[8,5], 45:[9,5], 46:[10,5],47:[11,5],48:[12,5],49:[13,5],50:[14,5],51:[15,5],52:[16,5],53:[17,5],54:[18,5],
  55:[1,6], 56:[2,6], 72:[4,6], 73:[5,6], 74:[6,6], 75:[7,6], 76:[8,6], 77:[9,6], 78:[10,6],79:[11,6],80:[12,6],81:[13,6],82:[14,6],83:[15,6],84:[16,6],85:[17,6],86:[18,6],
  87:[1,7], 88:[2,7],104:[4,7],105:[5,7],106:[6,7],107:[7,7],108:[8,7],109:[9,7],110:[10,7],111:[11,7],112:[12,7],113:[13,7],114:[14,7],115:[15,7],116:[16,7],117:[17,7],118:[18,7],
  // Lanthanides row 9 (La starts at col 3)
  57:[3,9],58:[4,9],59:[5,9],60:[6,9],61:[7,9],62:[8,9],63:[9,9],64:[10,9],65:[11,9],66:[12,9],67:[13,9],68:[14,9],69:[15,9],70:[16,9],71:[17,9],
  // Actinides row 10 (Ac starts at col 3)
  89:[3,10],90:[4,10],91:[5,10],92:[6,10],93:[7,10],94:[8,10],95:[9,10],96:[10,10],97:[11,10],98:[12,10],99:[13,10],100:[14,10],101:[15,10],102:[16,10],103:[17,10],
};

let ptSelectedEl = null;

function openPT() {
  document.getElementById('pt-overlay').classList.add('open');
  if (!document.getElementById('pt-grid').children.length) {
    buildPTGrid();
  }
  // Reset: deselect all cells and restore empty state panel
  document.querySelectorAll('.pt-cell.selected').forEach(c => c.classList.remove('selected'));
  ptSelectedEl = null;
  document.getElementById('pt-info-panel').innerHTML = `
    <div class="pt-info-empty">
      <svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
      <span>Select any element<br>to explore its properties</span>
    </div>
  `;
  _saveView('pt');
}

function closePT() {
  document.getElementById('pt-overlay').classList.remove('open');
  _clearView('pt');
}

function buildPTGrid() {
  const grid = document.getElementById('pt-grid');
  grid.style.gridTemplateRows = 'repeat(10, 52px)';

  // Build legend
  const legend = document.getElementById('pt-legend');
  legend.innerHTML = Object.entries(PT_CAT_LABELS).map(([cat, label]) =>
    `<div class="pt-legend-item">
      <div class="pt-legend-dot" style="background:${PT_CAT_COLORS[cat]}55;border:1px solid ${PT_CAT_COLORS[cat]}88;"></div>
      <span>${label}</span>
    </div>`
  ).join('');

  // Place elements
  PT_ELEMENTS.forEach(el => {
    const pos = PT_POSITIONS[el.n];
    if (!pos) return;
    const [col, row] = pos;
    const color = PT_CAT_COLORS[el.cat] || '#64748b';

    const cell = document.createElement('div');
    cell.className = `pt-cell cat-${el.cat}`;
    cell.style.gridColumn = col;
    cell.style.gridRow = row;
    cell.style.borderColor = color + '33';
    cell.innerHTML = `
      <span class="el-number">${el.n}</span>
      <span class="el-symbol">${el.sym}</span>
      <span class="el-name">${el.name.length > 9 ? el.name.substring(0,8)+'.' : el.name}</span>
      <span class="el-mass">${el.mass}</span>
    `;
    cell.title = el.name;
    cell.onclick = () => showElementInfo(el, cell, color);
    grid.appendChild(cell);
  });

  // Add La/Ac reference placeholders at col 3, rows 6 & 7
  // These point down to the lanthanide/actinide rows below
  const laPlaceholder = document.createElement('div');
  laPlaceholder.className = 'pt-cell cat-lanthanide pt-fblock-ref';
  laPlaceholder.style.cssText = 'grid-column:3;grid-row:6;cursor:default;';
  laPlaceholder.innerHTML = `
    <span class="el-number" style="font-size:6.5px;opacity:0.7;">57-71</span>
    <span class="el-symbol" style="font-size:11px;letter-spacing:-0.5px;">La-Lu</span>
    <span class="el-name" style="font-size:5.5px;opacity:0.6;">Lanthanide</span>
  `;
  grid.appendChild(laPlaceholder);

  const acPlaceholder = document.createElement('div');
  acPlaceholder.className = 'pt-cell cat-actinide pt-fblock-ref';
  acPlaceholder.style.cssText = 'grid-column:3;grid-row:7;cursor:default;';
  acPlaceholder.innerHTML = `
    <span class="el-number" style="font-size:6.5px;opacity:0.7;">89-103</span>
    <span class="el-symbol" style="font-size:11px;letter-spacing:-0.5px;">Ac-Lr</span>
    <span class="el-name" style="font-size:5.5px;opacity:0.6;">Actinide</span>
  `;
  grid.appendChild(acPlaceholder);
}

function showElementInfo(el, cell, color) {
  document.querySelectorAll('.pt-cell.selected').forEach(c => c.classList.remove('selected'));
  cell.classList.add('selected');
  ptSelectedEl = el;

  // Free tier: show the grid but block element properties
  if (isFreeTier()) {
    const panel = document.getElementById('pt-info-panel');
    panel.style.animation = 'none';
    panel.offsetHeight;
    panel.style.animation = 'pt-panel-slide 0.22s ease forwards';
    panel.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:16px;padding:32px 24px;text-align:center;">
        <div style="width:52px;height:52px;border-radius:50%;background:rgba(102,126,234,0.12);border:1px solid rgba(102,126,234,0.3);display:flex;align-items:center;justify-content:center;font-size:22px;">🔒</div>
        <div style="font-size:18px;font-weight:800;color:white;">${el.sym} — ${el.name}</div>
        <div style="font-size:13px;color:rgba(255,255,255,0.45);line-height:1.6;">Element properties are a<br><strong style="color:rgba(255,255,255,0.7);">Premium</strong> feature.</div>
        <button onclick="openPricingModal()" style="margin-top:4px;padding:10px 22px;background:linear-gradient(135deg,#667eea,#a855f7);border:none;border-radius:10px;color:white;font-size:13px;font-weight:700;cursor:pointer;">Unlock Premium</button>
      </div>
    `;
    return;
  }

  const protons = el.n;
  const electrons = el.n;
  const massNum = parseFloat(el.mass.replace(/[^0-9.]/g, ''));
  const neutrons = massNum ? Math.round(massNum - el.n) : '—';

  const panel = document.getElementById('pt-info-panel');
  panel.style.animation = 'none';
  panel.offsetHeight; // reflow
  panel.style.animation = 'pt-panel-slide 0.22s ease forwards';

  panel.innerHTML = `
    <!-- Hero -->
    <div class="pt-info-hero">
      <div class="pt-info-hero-bg" style="background: radial-gradient(ellipse at 50% 0%, ${color}40 0%, transparent 70%);"></div>
      <div class="pt-info-symbol-box" style="background:${color}1a; border: 1.5px solid ${color}40; box-shadow: 0 0 40px ${color}20, inset 0 1px 0 ${color}30;">
        <div class="big-atomic-num">${el.n}</div>
        <div class="big-symbol" style="color:${color}; text-shadow: 0 0 30px ${color}60;">${el.sym}</div>
        <div class="big-mass">${el.mass}</div>
      </div>
      <div class="pt-info-name">${el.name}</div>
      <div class="pt-info-category-pill" style="background:${color}18; border:1px solid ${color}35; color:${color};">
        ${PT_CAT_LABELS[el.cat]}
      </div>
      <div class="pt-desc">${el.desc}</div>
    </div>

    <!-- Subparticles -->
    <div class="pt-particles">
      <div class="pt-particle" style="background: rgba(239,68,68,0.05);">
        <div class="pt-particle-val" style="color:#f87171;">${protons}</div>
        <div class="pt-particle-label">Protons</div>
      </div>
      <div class="pt-particle" style="background: rgba(99,102,241,0.05);">
        <div class="pt-particle-val" style="color:#818cf8;">${neutrons}</div>
        <div class="pt-particle-label">Neutrons</div>
      </div>
      <div class="pt-particle" style="background: rgba(34,197,94,0.05);">
        <div class="pt-particle-val" style="color:#4ade80;">${electrons}</div>
        <div class="pt-particle-label">Electrons</div>
      </div>
    </div>

    <!-- Properties -->
    <div class="pt-props-section">
      <div class="pt-props-title">Properties</div>
      <div class="pt-props">
        <div class="pt-prop-row"><span class="pt-prop-key">Atomic Number</span><span class="pt-prop-val">${el.n}</span></div>
        <div class="pt-prop-row"><span class="pt-prop-key">Atomic Mass</span><span class="pt-prop-val">${el.mass} u</span></div>
        <div class="pt-prop-row"><span class="pt-prop-key">Group / Period</span><span class="pt-prop-val">${el.group} / ${el.period}</span></div>
        <div class="pt-prop-row"><span class="pt-prop-key">State at RT</span><span class="pt-prop-val">${el.state}</span></div>
        <div class="pt-prop-row"><span class="pt-prop-key">Melting Point</span><span class="pt-prop-val">${el.melt}</span></div>
        <div class="pt-prop-row"><span class="pt-prop-key">Boiling Point</span><span class="pt-prop-val">${el.boil}</span></div>
        <div class="pt-prop-row"><span class="pt-prop-key">Density</span><span class="pt-prop-val">${el.density}</span></div>
        <div class="pt-prop-row"><span class="pt-prop-key">Electronegativity</span><span class="pt-prop-val">${el.electronegativity}</span></div>
        <div class="pt-prop-row"><span class="pt-prop-key">Atomic Radius</span><span class="pt-prop-val">${el.radius}</span></div>
        <div class="pt-prop-row"><span class="pt-prop-key">Discovered</span><span class="pt-prop-val">${el.discovered}</span></div>
      </div>
    </div>

    <!-- Electron Config -->
    <div class="pt-config-section">
      <div class="pt-props-title" style="padding:0 0 8px 0; display:block;">Electron Configuration</div>
      <div class="pt-electron-config" style="color:${color}; background:${color}0f; border: 1px solid ${color}28;">${el.config}</div>
    </div>
  `;
}

// Detect periodic table mention in AI response
function detectPeriodicTableMention(text) {
  if (!text) return false;
  const keywords = ['periodic table','periodic element','element symbol','atomic number','atomic mass','noble gas','alkali metal','alkaline earth','transition metal','lanthanide','actinide','valence electron','electron configuration','electronegativity','ionization energy','show me the periodic','view the periodic','open the periodic'];
  const lower = text.toLowerCase();
  return keywords.some(k => lower.includes(k));
}

// Close on overlay click
document.addEventListener('click', function(e) {
  const overlay = document.getElementById('pt-overlay');
  if (overlay && e.target === overlay) closePT();
});

// Escape key
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closePT();
});

// Initialize Lucide icons
if (typeof lucide !== 'undefined') {
    lucide.createIcons();
    
    // Re-initialize Lucide icons when molecule modal opens
    const originalOpenModal = openMoleculeModal;
    openMoleculeModal = async function(moleculeName) {
        await originalOpenModal(moleculeName);
        setTimeout(() => {
            lucide.createIcons();
        }, 100);
    };
}

// ═══════════════════════════════════════════════════════════════
// CHUNKS V2 — ALL 10/10 UPGRADES
// ═══════════════════════════════════════════════════════════════

// ── 1. FIRST-TIME ONBOARDING TOUR ───────────────────────────────
let _obtStep = 0;
const OBT_KEY = 'chunks_onboarding_v1_done';

function showOnboardingTour() {
  if (localStorage.getItem(OBT_KEY)) return;
  const el = document.getElementById('onboarding-tour');
  if (el) el.classList.add('show');
}

function onboardingNext() {
  const steps = 3;
  _obtStep++;
  if (_obtStep >= steps) { dismissOnboardingTour(); return; }
  // Hide current step, show next
  for (let i = 0; i < steps; i++) {
    const s = document.getElementById('obt-step-' + i);
    if (s) s.style.display = i === _obtStep ? 'block' : 'none';
  }
  // Update dots
  for (let i = 0; i < steps; i++) {
    const d = document.getElementById('obt-dot-' + i);
    if (!d) continue;
    d.classList.toggle('obt-dot-active', i === _obtStep);
    d.style.width = i === _obtStep ? '24px' : '8px';
    d.style.background = i === _obtStep ? '#818cf8' : 'rgba(255,255,255,0.15)';
    d.style.borderRadius = i === _obtStep ? '4px' : '50%';
  }
  // Last step: change button text
  const btn = document.getElementById('obt-next');
  if (btn && _obtStep === steps - 1) { btn.textContent = "Let's go! 🚀"; }
}

function dismissOnboardingTour() {
  const el = document.getElementById('onboarding-tour');
  if (el) { el.style.opacity = '0'; el.style.transition = 'opacity 0.25s'; setTimeout(() => el.classList.remove('show'), 250); }
  localStorage.setItem(OBT_KEY, '1');
}

// Trigger after auth — only for brand new users
(function _initOnboarding() {
  // We hook into initAuth completion — check after a short delay
  setTimeout(() => {
    const isGuest   = typeof isGuestMode !== 'undefined' && isGuestMode;
    const hasChats  = !!localStorage.getItem('chunks_chat_history_v2');
    const isDone    = !!localStorage.getItem(OBT_KEY);
    if (!isDone && !hasChats) showOnboardingTour();
  }, 1800);
})();

// ── 2. STREAK WELCOME WIDGET ────────────────────────────────────
function renderStreakWidget() {
  try {
    const raw = localStorage.getItem('chunksProgress_global') || localStorage.getItem('chunks_progress');
    if (!raw) return;
    const p = JSON.parse(raw);
    const streak = p.studyStreak || p.bestStreak || 0;
    if (streak < 1) return;
    const widget = document.getElementById('streak-welcome-widget');
    if (!widget) return;
    const cntEl = widget.querySelector('.streak-count');
    const lblEl = widget.querySelector('.streak-label');
    if (cntEl) cntEl.textContent = streak;
    if (lblEl) lblEl.innerHTML = `${streak === 1 ? 'day' : 'days'} study streak 🔥<small>Keep it going — study something today!</small>`;
    widget.classList.add('show');
  } catch(e) {}
}

// ── 3. SOFT UPGRADE NUDGE at message 15 ─────────────────────────
(function _patchUpgradeNudge() {
  const _orig = typeof freeTierMessageLimitReached === 'function' ? freeTierMessageLimitReached : null;
  // Watch free tier count and show soft nudge at 15
  const _origIncrement = typeof incrementFreeTierMessageCount === 'function' ? incrementFreeTierMessageCount : null;
  if (!_origIncrement) return;
  window.incrementFreeTierMessageCount = function() {
    _origIncrement();
    try {
      const count = parseInt(localStorage.getItem('chunks_free_msg_count') || '0', 10);
      if (count === 15) _showUpgradeNudge();
    } catch(e) {}
  };
})();

function _showUpgradeNudge() {
  const existing = document.getElementById('upgrade-nudge-banner');
  if (existing) { existing.classList.add('show'); return; }
  const banner = document.createElement('div');
  banner.id = 'upgrade-nudge-banner';
  banner.className = 'show';
  banner.innerHTML = `
    <span class="nudge-icon">✨</span>
    <span class="nudge-text"><strong>5 messages left</strong> in your free daily limit. Sign in to save your chat and continue tomorrow, or upgrade for unlimited.</span>
    <button class="nudge-cta" onclick="openPricingModal ? openPricingModal() : window.location.href='subscribe.html'">Upgrade</button>
    <button class="nudge-dismiss" onclick="this.closest('#upgrade-nudge-banner').classList.remove('show')">✕</button>
  `;
  const msgs = document.getElementById('chat-messages');
  if (msgs) msgs.appendChild(banner);
}

// ── 4. MOBILE: ensure complexity slider always visible ──────────
(function _fixMobileSlider() {
  // Force ni-level-group visible — remove all the hide overrides via JS
  function _ensureSlider() {
    const lg = document.querySelector('.ni-level-group');
    if (!lg) return;
    lg.style.removeProperty('display'); // Let CSS handle it normally
    // Add show-mobile class so the CSS .show-mobile rule applies
    lg.classList.add('show-mobile');
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _ensureSlider);
  } else {
    _ensureSlider();
  }
})();

// ── 5. PERFORMANCE: API prefetch on hover ───────────────────────
(function _prefetchOnHover() {
  const API_URL = window.API_URL || window.__API_URL__ || 'https://chunksai.up.railway.app';
  let _pinged = false;
  function _ping() {
    if (_pinged) return;
    _pinged = true;
    fetch(API_URL + '/api/health', { method: 'GET', signal: AbortSignal.timeout(3000) }).catch(() => {});
  }
  // Ping when user mouses over the chat input (shows intent)
  document.addEventListener('mousemove', _ping, { once: true });
  document.addEventListener('touchstart', _ping, { once: true });
})();

// ── 6. INIT: run streak widget when welcome shows ───────────────
(function _hookStreakToWelcome() {
  // MutationObserver: watch for welcome screen becoming visible
  const _obs = new MutationObserver(() => {
    const ws = document.getElementById('welcome-screen');
    if (ws && !ws.classList.contains('hidden')) {
      renderStreakWidget();
      _obs.disconnect();
    }
  });
  const ws = document.getElementById('welcome-screen');
  if (ws) _obs.observe(ws, { attributes: true, attributeFilter: ['class'] });
  // Also try immediately in case already visible
  setTimeout(renderStreakWidget, 1200);
})();
