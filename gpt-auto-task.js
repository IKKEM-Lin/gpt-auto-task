// ==UserScript==
// @namespace         https://greasyfork.org/zh-CN/users/1106595-ikkem-lin
// @name              GPT Auto task
// @author            Mark
// @description       根据缓存中的数据自动在网页上与chat gpt对话
// @description       "snippetSourceData", "mock_prompt1", "mock_prompt2", "model_number" 四个localStorage变量用于存储数据
// @homepageURL       https://github.com/IKKEM-Lin/gpt-auto-task
// @version           0.1.7
// @match             *chat.openai.com/*
// @run-at            document-idle
// @require           https://cdnjs.cloudflare.com/ajax/libs/js-yaml/4.1.0/js-yaml.min.js
// @require           https://cdn.jsdelivr.net/npm/idb-keyval@6/dist/umd.js
// ==/UserScript==
(function () {
  "use strict";

  const tableName = "data";

  const dbTable = {
    // tasks: idbKeyval.createStore("tasks", tableName),
    skipSnippet: idbKeyval.createStore("skipSnippet", tableName),
    response1: idbKeyval.createStore("response1", tableName),
    response2: idbKeyval.createStore("response2", tableName),
    responseProcessed: idbKeyval.createStore("responseProcessed", tableName),
  };

  const locationReload = () => {
    location.href = "https://chat.openai.com/?model=gpt-4";
  }

  const downloadFile = (data, fileName) => {
    const a = document.createElement("a");
    document.body.appendChild(a);
    a.style = "display: none";
    const blob = new Blob([data], {
      type: "application/octet-stream",
    });
    const url = window.URL.createObjectURL(blob);
    a.href = url;
    a.download = fileName;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const yaml2object = (yamlStr) => {
    try {
      return jsyaml.load(yamlStr);
    } catch (error) {
      return null;
    }
  };

  function hashFnv32a(str, asString = true, seed = undefined) {
    /*jshint bitwise:false */
    var i,
      l,
      hval = seed === undefined ? 0x811c9dc5 : seed;

    for (i = 0, l = str.length; i < l; i++) {
      hval ^= str.charCodeAt(i);
      hval +=
        (hval << 1) + (hval << 4) + (hval << 7) + (hval << 8) + (hval << 24);
    }
    if (asString) {
      // Convert to 8 digit hex string
      return ("0000000" + (hval >>> 0).toString(16)).substr(-8);
    }
    return hval >>> 0;
  }

  function reactionObjHandler(input) {
    let result = [];
    const validateKeys = ["reactants", "products", "condition", "catalysts"];
    function test(reaction) {
      // if (!reaction) {
      //     return
      // }
      if (reaction instanceof Array) {
        return reaction.map((item) => {
          return test(item);
        });
      } else {
        try {
          var keys = Object.keys(reaction);
        } catch (error) {
          //   debugger;
          console.error(error);
          throw new Error();
        }
        if (validateKeys.some((key) => keys.includes(key))) {
          result.push(reaction);
          return;
        }
        keys.forEach((key) => {
          if (reaction[key] && typeof reaction[key] === "object") {
            test(reaction[key]);
          }
        });
      }
    }
    test(input);
    return result;
  }

  class GPT_ASK_LOOP {
    queue = [];
    abstract = [];
    responds = [];
    checkInterval = 20000;
    account = "";
    downloadBtn = null;
    retrying = false;
    defaultMode = 2;
    lastSaveTime = 0;

    INPUT_SELECTOR = "#prompt-textarea";
    SUBMIT_BTN_SELECTOR = "#prompt-textarea + button";
    RESPOND_SELECTOR = "main .group.text-token-text-primary";
    NEW_CHART_BTN_SELECTOR = "nav>div.mb-1>a:first-child";
    NORMAL_RESPOND_BTN_SELECTOR = "form div button.btn-neutral";
    ERROR_RESPOND_BTN_SELECTOR = "form div button.btn-primary";

    sleep(duration) {
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          resolve(true);
        }, duration);
      });
    }

    constructor(account) {
      this.initData().then(() => {
        this.account = account || Math.ceil(Math.random() * 1e10).toString(32);
        const btnWrap = document.createElement("div");
        btnWrap.innerHTML = `<button style="padding: 4px 8px;position: fixed;bottom: 20%;right: 8px;border-radius: 4px;background-color: #224466;color: #fff;">下载已生成结果（queue: ${this.queue.length}, res: ${this.responds.length}）</button>`;
        this.downloadBtn = btnWrap.querySelector("button");
        this.downloadBtn.onclick = this.handleDownload.bind(this);
        document.body.appendChild(btnWrap);
        const btnWrapBackup = document.createElement("div");
        btnWrapBackup.innerHTML = `<button style="padding: 4px 8px;position: fixed;bottom: 30%;right: 8px;border-radius: 4px;background-color: #224466;color: #fff;">备份</button>`;
        const backupBtn = btnWrapBackup.querySelector("button");
        backupBtn.onclick = this.backUp.bind(this);
        document.body.appendChild(btnWrapBackup);
        this.main();
      });
    }

    async initData() {
      const skipSnippetKeys = await idbKeyval.keys(dbTable.skipSnippet);
      const responseKeys = await idbKeyval.keys(dbTable.responseProcessed);
      const responseValues = await idbKeyval.values(dbTable.responseProcessed);
      this.responds = responseValues.map((item) => ({
        articleId: item.articleId,
        snippetId: item.snippetId,
        createdTime: item.createdTime,
      }));
      const snippetSourceData = JSON.parse(
        localStorage.getItem("snippetSourceData") || "[]"
      );
      this.abstract = snippetSourceData.filter(
        (item) => item.type == "abstract"
      );
      const paragraphs = snippetSourceData.filter(
        (item) => item.type != "abstract"
      );
      this.queue = paragraphs.filter(
        (item) =>
          !(responseKeys || []).includes(`${item.article_id}-${item.id}`) &&
          !(skipSnippetKeys || []).includes(`${item.article_id}-${item.id}`)
      );
      if (this.queue.length !== 0) {
        return;
      }
      this.queue = paragraphs.filter((item) =>
        (skipSnippetKeys || []).includes(`${item.article_id}-${item.id}`)
      );
    }

    async backUp() {
      const response1 = await idbKeyval.entries(dbTable.response1);
      const response2 = await idbKeyval.entries(dbTable.response2);
      const responseProcessed = await idbKeyval.entries(dbTable.responseProcessed);

      const now = new Date();
      const current = `${now.getFullYear()}-${
        now.getMonth() + 1
      }-${now.getDate()}-${now.getHours()}${now.getMinutes()}${now.getSeconds()}`;
      downloadFile(
        JSON.stringify(response1), `backup-${current}-response1-${response1.length}.json`
      );
      downloadFile(
        JSON.stringify(response2), `backup-${current}-response2-${response2.length}.json`
      );
      downloadFile(
        JSON.stringify(responseProcessed), `backup-${current}-responseProcessed-${responseProcessed.length}.json`
      );
    }

    async handleDownload() {
      const reactionGroups = await idbKeyval.values(dbTable.responseProcessed);
      if (!reactionGroups.length) {
        return;
      }
      const reactions = [];
      reactionGroups.forEach((item) => {
        const { articleId, snippetId, reaction } = item;
        const uniqReaction = Array.from(
          new Set(reaction.map((v) => JSON.stringify(v)))
        ).map((v) => JSON.parse(v));
        uniqReaction.forEach((data) => {
          const name = hashFnv32a(JSON.stringify(data));
          reactions.push({ articleId, snippetId, data, name });
        });
      });

      const now = new Date();
      downloadFile(
        JSON.stringify(reactions),
        `${now.getFullYear()}-${
          now.getMonth() + 1
        }-${now.getDate()}-${now.getHours()}${now.getMinutes()}${now.getSeconds()}-${
          reactions.length
        }.json`
      );
    }

    async report(tip = "") {
      await fetch("https://gpt-hit.deno.dev/api/update", {
        method: "POST",
        body: JSON.stringify({
          account: this.account,
          reaction_count: this.responds.length,
          queue_count: this.queue.length,
          tip: tip,
        }),
      }).catch((err) => {
        console.error({ err });
      });
    }

    genPrompt(content, step = 1) {
      return step === 1
        ? `${localStorage.getItem("mock_prompt" + step)}
  
              ''' ${content} ''' `
        : localStorage.getItem("mock_prompt" + step);
    }

    _updateDownloadBtnText() {
      if (this.downloadBtn) {
        const snippetSourceData = JSON.parse(
          localStorage.getItem("snippetSourceData") || "[]"
        );
        const paragraphs = snippetSourceData.filter(
          (item) => item.type != "abstract"
        );
        this.downloadBtn.innerText = `下载已生成结果（queue: ${
          this.queue.length
        }, res: ${this.responds.length}, skip: ${
          paragraphs.length - this.queue.length - this.responds.length
        }）`;
      }
    }

    _getLastRespondTime() {
      return Math.max.apply(
        null,
        this.responds
          .map((item) => item.createdTime)
          .filter((item) => item)
          .concat([0])
      );
    }

    getTask() {
      const task = this.queue[0];
      const maxTime = this._getLastRespondTime();
      this.report(
        (task &&
          `Working on articleId: ${task.article_id}, snippetId: ${
            task.id
          }, last-update-time: ${new Date(maxTime).toLocaleString()}`) ||
          ""
      );
      if (!task) {
        console.log("任务队列为空");
        return async () => null;
      }
      return async () => {
        const { article_id, id, content } = task;
        const relatedAbstract =
          this.abstract.find((item) => item.article_id === article_id)
            ?.content || "";
        console.log(
          `开始触发 ${article_id}-${id}, ${new Date().toTimeString()}`
        );
        const promptContent = `
                  ${relatedAbstract}
  
                  ${content}
                  `;
        const prompt1 = this.genPrompt(promptContent, 1);
        const prompt2 = this.genPrompt(promptContent, 2);
        const result1 = await this.trigger(prompt1).catch((err) => {
          return null;
        });
        if (!result1) {
          return null;
        }
        await idbKeyval.set(
          `${article_id}-${id}`,
          {
            articleId: article_id,
            snippetId: id,
            reaction: result1,
            createdTime: new Date().valueOf(),
          },
          dbTable.response1
        );
        await this.sleep(3 * 1000);
        const result2 = await this.trigger(prompt2).catch((err) => {
          return null;
        });
        if (!result2) {
          return { articleId: article_id, snippetId: id, reaction: result1 };
        }
        await idbKeyval.set(
          `${article_id}-${id}`,
          {
            articleId: article_id,
            snippetId: id,
            reaction: result2,
            createdTime: new Date().valueOf(),
          },
          dbTable.response2
        );
        return { articleId: article_id, snippetId: id, reaction: result2 };
      };
    }

    async rawReactionProcess(rawReactionHTML) {
      const ele = document.createElement("div");
      ele.innerHTML = rawReactionHTML;
      const res = Array.from(ele.querySelectorAll("code"))
        .map((el) => el.innerText)
        .map((yml) => yaml2object(yml));

      if (res && res.length > 0 && res.every((s) => s !== null)) {
        const result = reactionObjHandler(res);
        return result.length > 0 ? result : null;
      }
      return null;
    }

    async skipSnippetHandler(articleId, snippetId) {
      const oldVal = await idbKeyval.get(
        `${articleId}-${snippetId}`,
        dbTable.skipSnippet
      );
      await idbKeyval.set(
        `${articleId}-${snippetId}`,
        (oldVal || 0) + 1,
        dbTable.skipSnippet
      );
      this.queue = this.queue.filter((item) => item.id !== snippetId);
    }

    async saveRespond(respond) {
      const { articleId, snippetId } = respond;
      const currentTimeStamp = new Date().valueOf();
      const reactionProcessed = await this.rawReactionProcess(respond.reaction);
      if (!reactionProcessed) {
        console.warn(`${articleId}-${snippetId} 无法解析出 reaction, 即将跳过`);
        await this.skipSnippetHandler(articleId, snippetId);
        return;
      }
      this.responds.push({
        articleId,
        snippetId,
        createdTime: currentTimeStamp,
      });
      this.queue = this.queue.filter((item) => item.id !== snippetId);

      await idbKeyval.set(
        `${articleId}-${snippetId}`,
        {
          ...respond,
          reaction: reactionProcessed,
          createdTime: new Date().valueOf(),
        },
        dbTable.responseProcessed
      );
      try {
        await idbKeyval.del(`${articleId}-${snippetId}`, dbTable.skipSnippet);
      } catch (err) {}
      if (this.responds.length && this.responds.length % 50 === 0) {
        this.handleDownload.bind(this)();
      }
    }

    trigger(prompt, checkInterval = this.checkInterval) {
      return new Promise((resolve, reject) => {
        const textEl = document.querySelector(this.INPUT_SELECTOR);
        const submitEl = document.querySelector(this.SUBMIT_BTN_SELECTOR);
        textEl.value = prompt;
        textEl.dispatchEvent(new Event("input", { bubbles: true }));
        setTimeout(() => {
          submitEl.click();

          let resCache = null;
          let checkOutputCount = 0;
          (async () => {
            while (true) {
              await this.sleep(checkInterval);
              const result = Array.from(
                document.querySelectorAll(this.RESPOND_SELECTOR)
              );
              const temp = result[result.length - 1];
              if (!temp) {
                if (checkOutputCount > 0) {
                  console.log("检查结果超时");
                  reject(null);
                  break;
                }
                checkOutputCount++;
                continue;
              }
              if (resCache === temp.innerHTML) {
                // console.log("匹配，resCache:", resCache);
                const validateResult = await this.validate(resCache).catch(
                  (err) => {
                    reject(null);
                    return;
                  }
                );
                if (validateResult === true) {
                  resolve(resCache);
                  break;
                } else if (validateResult === false) {
                  continue;
                }
                reject(null);
                break;
              }
              resCache = temp.innerHTML;
              console.log(`${checkInterval / 1000}s后再次检查结果`);
            }
          })();
        }, 4000);
      });
    }

    async validate(innerHTML) {
      const buttons = document.querySelectorAll(
        this.NORMAL_RESPOND_BTN_SELECTOR
      );
      const errorBtn = document.querySelectorAll(
        this.ERROR_RESPOND_BTN_SELECTOR
      );
      // 如果触发gpt-4 3小时25次限制
      if (!buttons[0] && !errorBtn[0] && innerHTML.includes("usage cap")) {
        console.error("触发gpt-4 3小时25次限制,等待10min后重试");
        await this.sleep(10 * 60 * 1000);
        throw new Error("触发gpt-4 3小时25次限制");
      }
      // 如果openAI服务器报错未返回结果
      if (errorBtn[0]) {
        // && innerHTML.includes("wrong")) {
        if (this.retrying) {
          this.retrying = false;
          return true;
        }
        errorBtn[0].click();
        this.retrying = true;
        return false;
      }
      // 如果输出结果未包含code标签
      if (!innerHTML.includes("</code>")) {
        if (this.retrying) {
          this.retrying = false;
          console.error("第二次还是未输出yaml结构");
          throw new Error("未返回yaml结构");
        }
        console.error("未输出yaml结构，重试一次");
        buttons[0].click();
        this.retrying = true;
        return false;
      }
      this.retrying = false;
      // 如果还未完全输出
      if (buttons.length > 1 && !buttons[buttons.length - 1].innerText.includes("Regenerate")) {
        buttons[buttons.length - 1].click();
        return false;
      }
      return true;
    }

    async main(sleepTime = 5000) {
      let emptyCount = 0;
      while (true) {
        // {0: gpt-3.5, 1: gpt-4, 2: gpt-4 mobile}
        const modelNum =
          +localStorage.getItem("model_number") || this.defaultMode;
        const gpt4btn = document.querySelectorAll(
          "ul > li > button.cursor-pointer"
        )[modelNum];

        if (gpt4btn) {
          console.log(`当前模型为：${gpt4btn.innerText}`);
          gpt4btn.firstChild.click();
        } else {
          console.warn(`无法选择模型，2分钟后刷新`);
          await this.sleep(2 * 60 * 1000);
          locationReload();
        }
        await this.sleep(sleepTime / 2);
        if (modelNum === 1 && !(location.href.endsWith("gpt-4") || gpt4btn.firstChild.className?.includes("shadow"))) {
          console.log("未切换到gpt-4模式, 5分钟后重试");
          const maxTime = this._getLastRespondTime();
          const diff = new Date().valueOf() - maxTime;
          if (maxTime && diff > 1.5 * 60 * 60 * 1000) {
            console.warn("超时未刷新, 5分钟后刷新页面");
            await this.sleep(5 * 60 * 1000);
            locationReload();
            break;
          }
          this.report(
            `触发gpt-4 3小时25次限制，上次运行时间：${new Date(
              maxTime
            ).toLocaleString()}`
          );
          await this.sleep(5 * 60 * 1000);
          const newChatBtn = document.querySelector(
            this.NEW_CHART_BTN_SELECTOR
          );
          newChatBtn.click();
          continue;
        }
        const task = this.getTask();
        if (!task) {
          if (emptyCount > 0) {
            console.warn("连续两次未获取到任务，2分钟后刷新");
            await this.sleep(2 * 60 * 1000);
            locationReload();
            break;
          }
          emptyCount++;
          await this.sleep(5 * 60 * 1000);
          continue;
        }

        const result = await task();
        if (result) {
          this.saveRespond(result);
          emptyCount = 0;
        } else {
          if (emptyCount > 0) {
            const task = this.queue[0];
            const { article_id, id } = task;
            console.warn(
              `${article_id}-${id}连续两次未获取到任务值，2分钟后刷新`
            );
            await this.skipSnippetHandler(article_id, id);
            await this.sleep(2 * 60 * 1000);
            locationReload();
            break;
          }
          emptyCount += 1;
        }
        console.log(`${sleepTime / 1000}s后将再次触发`);
        const newChatBtn = document.querySelector(this.NEW_CHART_BTN_SELECTOR);
        newChatBtn.click();
        await this.sleep(sleepTime / 2);
        this._updateDownloadBtnText();
      }
    }
  }

  function secondInterval() {
    console.log("start secondInterval...");
    const sleep = (duration) => {
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          resolve(true);
        }, duration);
      });
    };
    setInterval(async () => {
      const responds = await idbKeyval.values(dbTable.responseProcessed);
      const maxTime = Math.max.apply(
        null,
        responds
          .map((item) => item.createdTime)
          .filter((item) => item)
          .concat([0])
      );
      const diff = new Date().valueOf() - maxTime;

      console.log(`last updated at: ${maxTime}, diff is ${diff}`);
      if (maxTime && diff > 30 * 60 * 1000) {
        console.warn("超时未刷新, 2分钟后刷新页面");
        await sleep(2 * 60 * 1000);
        locationReload();
      }
    }, 10 * 60 * 1000);
  }

  function start() {
    const ACCOUNT_NAME_SELECTOR = "nav > div:last-child > div:last-child";
    const nameEl = document.querySelector(ACCOUNT_NAME_SELECTOR);
    const name = nameEl && nameEl.innerText;
    if (name) {
      new GPT_ASK_LOOP(name);
      secondInterval();
    } else {
      setTimeout(() => {
        start();
      }, 5000);
    }
  }
  start();
})();
