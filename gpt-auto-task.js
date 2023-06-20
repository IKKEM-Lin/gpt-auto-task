// ==UserScript==
// @namespace         https://greasyfork.org/zh-CN/users/1106595-ikkem-lin
// @name              网页限制解除(改)
// @author            Mark
// @description       自动在网页上与chat gpt对话
// @homepageURL       https://github.com/IKKEM-Lin/gpt-auto-task
// @version           0.0.1
// @match             *chat.openai.com/*
// @run-at            document-idle
// ==/UserScript==
(function () {
  "use strict";
  class GPT_ASK_LOOP {
    queue = [];
    responds = [];
    checkInterval = 10000;
    account = "";

    constructor(account) {
      this.responds = JSON.parse(
        localStorage.getItem("reaction_responds") || "[]"
      );
      const queueCache = JSON.parse(localStorage.getItem("task_queue") || "[]");
      const resSnippetIds = this.responds.map((respond) => respond.snippetId);
      this.queue = queueCache.filter(
        (item) => !resSnippetIds.includes(item.id)
      );
      this.account = account || document.querySelector('nav > div:last-child > div:last-child').innerText || Math.ceil(Math.random() * 1e10).toString(32);
      this.main();
    }

    async report() {
      await fetch("https://gpt-hit.deno.dev/api/update", {
        method: "POST",
        body: JSON.stringify({
          account: this.account,
          reaction_count: this.responds.length,
          queue_count: this.queue.length,
        }),
      });
    }

    genPrompt(content) {
      return `${localStorage.getItem("mock_prompt")}
      
          ''' ${content} ''' `;
    }

    getTask() {
      this.report();
      const task = this.queue[0];
      if (!task) {
        console.log("任务队列为空");
        return;
      }
      return async () => {
        const { article_id, id, content } = task;
        console.log(
          `开始触发 ${article_id}-${id}, ${new Date().toTimeString()}`
        );
        const prompt = this.genPrompt(content);
        const result = await this.trigger(prompt);
        return { articleId: article_id, snippetId: id, reaction: result };
        // console.log("result:", result);
      };
    }

    saveRespond(respond) {
      const { snippetId } = respond;
      this.responds.push(respond);
      this.queue = this.queue.filter((item) => item.id !== snippetId);
      localStorage.setItem("task_queue", JSON.stringify(this.queue));
      localStorage.setItem("reaction_responds", JSON.stringify(this.responds));
    }

    sleep(duration) {
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          resolve(true);
        }, duration);
      });
    }

    trigger(prompt, checkInterval = this.checkInterval) {
      return new Promise((resolve, reject) => {
        const textEl = document.querySelector("#prompt-textarea");
        const submitEl = document.querySelector("#prompt-textarea + button");
        textEl.value = prompt; //`你好, 帮我算下${Math.floor(Math.random() * 10000)}开平方的结果`;
        textEl.dispatchEvent(new Event("input", { bubbles: true }));
        setTimeout(() => {
          submitEl.click();

          let resCache = null;
          (async () => {
            while (true) {
              await this.sleep(checkInterval);
              const result = Array.from(
                document.querySelectorAll("main .group")
              );
              const temp = result[result.length - 1];
              if (!temp) {
                continue;
              }
              if (resCache === temp.innerHTML) {
                // console.log("匹配，resCache:", resCache);
                resolve(resCache);
                break;
              }
              resCache = temp.innerHTML;
              console.log(`${checkInterval / 1000}s后再次检查结果`);
            }
          })();
        }, 4000);
      });
    }

    async main(sleepTime = 5000) {
      while (true) {
        const task = this.getTask();
        if (!task) {
          this.sleep(5 * 60 * 1000);
          return;
        }

        const result = await task();
        this.saveRespond(result);
        console.log(`${sleepTime / 1000}s后将再次触发`);
        const newChatBtn = document.querySelector("nav>div.mb-1>a:first-child");
        newChatBtn.click();
        await this.sleep(sleepTime);
      }
    }
  }

  new GPT_ASK_LOOP()
})();
