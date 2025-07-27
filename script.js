<script>
  const popularSubreddits = ['news', 'Palestine', 'mentalhealth', 'work','ireland','tech','IRL','TLdR'];

  function getTodayDate() {
    const today = new Date();
    return today.toISOString().split('T')[0];
  }

  function getDefaultStartDate() {
    const date = new Date();
    date.setMonth(date.getMonth() - 1);
    return date.toISOString().split('T')[0];
  }

  function applyDateRange() {
    const start = new Date(document.getElementById("startDate").value);
    const end = new Date(document.getElementById("endDate").value);
    fetchRedditData(start, end);
  }

  function toggleDetails(index) {
    const detailsRow = document.querySelectorAll("#sentimentTable tbody .details")[index];
    detailsRow.style.display = detailsRow.style.display === "table-row" ? "none" : "table-row";
  }

  function getSentimentScore(text) {
    const positiveWords = [
      'happy', 'joy', 'excited', 'love', 'optimistic', 'inspired', 'grateful',
      'amazing', 'proud', 'confident', 'hopeful', 'great', 'cheerful', 'uplifted',
      'accomplished', 'peaceful', 'motivated', 'encouraged', 'better', 'progress', 'good life'
    ];

    const negativeWords = [
      'sad', 'angry', 'hate', 'depressed','deadly','dead', 'frustrated', 'hopeless', 'anxious',
  'scared', 'tired', 'lonely', 'miserable', 'worthless', 'failure', 'afraid',
  'numb', 'crying', 'helpless', 'guilt', 'ashamed', 'stressed', 'death', 'ache',
  'pain', 'grief', 'loss', 'broken', 'suffering', 'unworthy', 'hopelessness',
  'horror', 'dangerous', 'Ghislane','ghislane',
  'mourning', 'war', 'idf', 'israel', 'crisis', 'fails', 'scandal', 'decline',
  'warns', 'crash', 'struggles', 'falls', 'controversy', 'outrage', 'disaster',
  'accused', 'backlash', 'threat', 'blockage', 'controversial','warn','fears',
  'israeli','kill', 'attack', 'virus','killed','malnourishment', 'starvation',
  'starved','wildfires',
  'kills','chaotic','desperately','hungry','hunger','famine'
    ];

    const contrastWords = ['but', 'however', 'although'];
    const negativePhrases = [
      "don't", "can't", "won't", "shouldn't", "give up", "hate myself", "suicide", "trauma"
    ];

    const NEGATIVE_WEIGHT = 2;
    const PHRASE_PENALTY_PER_MATCH = 3;

    let positiveCount = 0;
    let negativeCount = 0;
    const lowerText = text.toLowerCase();

    positiveWords.forEach(word => {
      if (lowerText.includes(word)) positiveCount++;
    });

    negativeWords.forEach(word => {
      if (lowerText.includes(word)) negativeCount++;
    });

    for (const contrast of contrastWords) {
      const contrastIndex = lowerText.indexOf(contrast);
      if (contrastIndex !== -1) {
        const beforeContrast = lowerText.slice(0, contrastIndex);
        for (const word of positiveWords) {
          if (beforeContrast.includes(word)) {
            positiveCount = Math.max(positiveCount - 2, 0);
            break;
          }
        }
      }
    }

    let phrasePenalty = 0;
    for (const phrase of negativePhrases) {
      if (lowerText.includes(phrase)) {
        phrasePenalty += PHRASE_PENALTY_PER_MATCH;
      }
    }

    const weightedNegatives = (negativeCount * NEGATIVE_WEIGHT) + phrasePenalty;
    const totalWeighted = positiveCount + weightedNegatives;

    if (totalWeighted === 0) return 0;

    return (positiveCount - weightedNegatives) / totalWeighted;
  }

  async function fetchRedditData(startDate, endDate) {
    document.getElementById("loading").style.display = 'block';
    const subredditStats = {};
    const dateStats = {};
    const upliftingPosts = [];

    const subredditTableBody = document.getElementById("subredditTableBody");
    const sentimentTableBody = document.getElementById("sentimentTableBody");
    subredditTableBody.innerHTML = '';
    sentimentTableBody.innerHTML = '';

    for (let subreddit of popularSubreddits) {
      try {
        const response = await fetch(`https://www.reddit.com/r/${subreddit}/new.json?limit=30`);
        const posts = (await response.json()).data.children;

        posts.forEach(post => {
          const { title, selftext, created_utc, id } = post.data;
          const postDate = new Date(created_utc * 1000);
          if (postDate < startDate || postDate > endDate) return;

          const content = `${title} ${selftext}`;
          const sentimentScore = getSentimentScore(content);
          const emotion = sentimentScore > 0 ? 'Positive' : sentimentScore < 0 ? 'Negative' : 'Neutral';
          const dateStr = postDate.toISOString().split('T')[0];

          if (sentimentScore > 0) {
            upliftingPosts.push({ subreddit, title, sentimentScore, emotion, date: dateStr, postText: selftext, id });
          }

          if (!subredditStats[subreddit]) subredditStats[subreddit] = { count: 0, totalPolarity: 0 };
          subredditStats[subreddit].count++;
          subredditStats[subreddit].totalPolarity += sentimentScore;

          if (!dateStats[dateStr]) dateStats[dateStr] = { totalPolarity: 0, count: 0 };
          dateStats[dateStr].totalPolarity += sentimentScore;
          dateStats[dateStr].count++;
        });
      } catch (e) {
        console.error(`Error fetching subreddit ${subreddit}:`, e);
      }
    }

    upliftingPosts.sort((a, b) => b.sentimentScore - a.sentimentScore);
    upliftingPosts.slice(0, 30).forEach((post, i) => {
      const row = document.createElement("tr");
      row.classList.add('uplifting');
      row.innerHTML = `
        <td>${i + 1}</td>
        <td><a href="https://www.reddit.com/r/${post.subreddit}" target="_blank">${post.subreddit}</a></td>
        <td>${post.title}</td>
        <td>${post.sentimentScore.toFixed(2)}</td>
        <td>${post.emotion}</td>
        <td>${post.date}</td>
        <td>
          <button class="btn" onclick="alert('Boosted!')">👍</button>
          <button class="btn" onclick="alert('Flagged!')">🚩</button>
        </td>
        <td><button class="btn" onclick="toggleDetails(${i})">Details</button></td>
      `;

      const details = document.createElement("tr");
      details.classList.add('details');
      details.innerHTML = `<td colspan="8"><strong>Post Text:</strong> ${post.postText || 'No content available.'}</td>`;

      sentimentTableBody.appendChild(row);
      sentimentTableBody.appendChild(details);
    });

    const sorted = Object.entries(subredditStats).sort(([, a], [, b]) =>
      (b.totalPolarity / b.count) - (a.totalPolarity / a.count)
    );
    sorted.slice(0, 10).forEach(([name, stats]) => {
      const avg = stats.totalPolarity / stats.count;
      const row = document.createElement("tr");
      row.innerHTML = `<td><a href="https://www.reddit.com/r/${name}" target="_blank">${name}</a></td>
                       <td>${stats.count}</td><td>${avg.toFixed(2)}</td>`;
      subredditTableBody.appendChild(row);
    });

    plotLineGraph(dateStats);
    document.getElementById("loading").style.display = 'none';
  }

  function plotLineGraph(dateStats) {
    const dates = Object.keys(dateStats).sort();
    const avgPolarity = dates.map(d => dateStats[d].totalPolarity / dateStats[d].count);
    Plotly.newPlot('lineGraph', [{
      x: dates, y: avgPolarity, mode: 'lines+markers',
      line: { color: 'mediumseagreen' }
    }], {
      xaxis: { title: 'Date' }, yaxis: { title: 'Avg Polarity', range: [-1, 1] },
      margin: { t: 30 }
    });
  }

  document.getElementById("startDate").value = getDefaultStartDate();
  document.getElementById("endDate").value = getTodayDate();
  applyDateRange();
</script>
