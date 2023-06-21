// ==UserScript==
// @namespace         https://greasyfork.org/zh-CN/users/1106595-ikkem-lin
// @name              GPT Auto task
// @author            Mark
// @description       自动在网页上与chat gpt对话
// @homepageURL       https://github.com/IKKEM-Lin/gpt-auto-task
// @version           0.0.7
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
        downloadBtn = null;
        retrying = false;
 
        constructor(account) {
            this.responds = JSON.parse(
                localStorage.getItem("reaction_responds") || "[]"
            );
            const queueCache = JSON.parse(localStorage.getItem("task_queue") || "[]");
            const resSnippetIds = this.responds.map((respond) => respond.snippetId);
            this.queue = queueCache.filter((item) => !resSnippetIds.includes(item.id));
            this.account = account || Math.ceil(Math.random() * 1e10).toString(32);
            const btnWrap = document.createElement("div");
            btnWrap.innerHTML = `<button style="padding: 4px 8px;position: fixed;bottom: 20%;right: 8px;border-radius: 4px;background-color: #224466;color: #fff;">下载已生成结果（queue: ${this.queue.length}, res: ${this.responds.length}）</button>`;
            this.downloadBtn = btnWrap.querySelector("button");
            this.downloadBtn.onclick = this.handleDownload.bind(this);
            document.body.appendChild(btnWrap);
            this.main();
        }
 
        handleDownload() {
            const respond = JSON.parse(
                localStorage.getItem("reaction_responds") || "[]"
            );
            if (!respond.length) {
                return;
            }
            const result = respond.map((item) => {
                const ele = document.createElement("div");
                ele.innerHTML = item.reaction;
                const res = Array.from(ele.querySelectorAll("code")).map(
                    (el) => el.innerText
                );
                return { ...item, reaction: res };
            });
            const now = new Date();
            this.downloadFile(
                JSON.stringify(result),
                `${now.getFullYear()}-${now.getMonth() + 1
                }-${now.getDate()}-${now.getHours()}${now.getMinutes()}${now.getSeconds()}.json`
            );
        }
 
        downloadFile(data, fileName) {
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
        }
 
        async report() {
            await fetch("https://gpt-hit.deno.dev/api/update", {
                method: "POST",
                body: JSON.stringify({
                    account: this.account,
                    reaction_count: this.responds.length,
                    queue_count: this.queue.length,
                }),
            }).catch((err) => {
                console.error({ err });
            });
        }
 
        genPrompt(content) {
            return `${localStorage.getItem("mock_prompt")}
 
            ''' ${content} ''' `;
        }
 
        getTask() {
            this.report();
            if (this.downloadBtn) {
                this.downloadBtn.innerText = `下载已生成结果（queue: ${this.queue.length}, res: ${this.responds.length}）`;
            }
            const task = this.queue[0];
            if (!task) {
                console.log("任务队列为空");
                return;
            }
            return async () => {
                const { article_id, id, content } = task;
                console.log(`开始触发 ${article_id}-${id}, ${new Date().toTimeString()}`);
                const prompt = this.genPrompt(content);
                const result = await this.trigger(prompt).catch((err) => {
                    return null
                });
                if (!result) {
                    return null;
                }
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
                            const result = Array.from(document.querySelectorAll("main .group"));
                            const temp = result[result.length - 1];
                            if (!temp) {
                                continue;
                            }
                            if (resCache === temp.innerHTML) {
                                // console.log("匹配，resCache:", resCache);
                                const validateResult = await this.validate(resCache).catch(err => {
                                    reject(null);
                                    return;
                                })
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
            const buttons = document.querySelectorAll("form div button.btn-neutral");
            const errorBtn = document.querySelectorAll("form div button.btn-primary");
            // 如果触发gpt-4 3小时25次限制
            if (!buttons[0] && !errorBtn[0] && innerHTML.includes("usage cap")) {
                console.error("触发gpt-4 3小时25次限制,等待10min后重试")
                await this.sleep(10 * 60 * 1000);
                throw new Error("触发gpt-4 3小时25次限制");
            }
            // 如果openAI服务器报错未返回结果
            if (errorBtn[0] && innerHTML.includes("wrong")) {
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
                    return true;
                }
                console.error("未输出yaml结构，重试一次")
                buttons[0].click();
                this.retrying = true;
                return false;
            }
            this.retrying = false;
            // 如果还未完全输出
            if (buttons.length > 1) {
                buttons[buttons.length - 1].click();
                return false;
            }
            return true;
        }
 
        async main(sleepTime = 5000) {
            while (true) {
                // {0: gpt-3.5, 1: gpt-4, 2: gpt-4 mobile}
                const modelNum = localStorage.getItem("model_number") || 1;
                const gpt4btn = document.querySelectorAll("ul > li > button.cursor-pointer")[modelNum];
                if (gpt4btn) {
                    gpt4btn.firstChild.click()
                }
                await this.sleep(sleepTime/2);
                const task = this.getTask();
                if (!task) {
                    await this.sleep(5 * 60 * 1000);
                    continue;
                }
 
                const result = await task();
                if (result) {
                    this.saveRespond(result);
                }
                console.log(`${sleepTime / 1000}s后将再次触发`);
                const newChatBtn = document.querySelector("nav>div.mb-1>a:first-child");
                newChatBtn.click();
                await this.sleep(sleepTime/2);
            }
        }
    }
 
    function start() {
        const nameEl = document.querySelector(
            "nav > div:last-child > div:last-child"
        )
        const name = nameEl && nameEl.innerText;
        if (name) {
            new GPT_ASK_LOOP(name);
        } else {
            setTimeout(() => {
                start();
            }, 5000);
        }
    }
    start();
 
})();