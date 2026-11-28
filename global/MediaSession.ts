export class MediaSessionIntegration {
    public audioTag = document.createElement("audio");
    public _onMediaSessionPlay: () => void;
    public _onMediaSessionPause: () => void;
    public _onMediaSessionStop: () => void;
    public _onMediaSessionSeekBackward: () => void;
    public _onMediaSessionSeekForward: () => void;
    public _onMediaSessionSeekTo: () => void;
    constructor() {
        this.audioTag.src = "silence.mp3";
        this.audioTag.loop = true;
        document.body.appendChild(this.audioTag);

        const imgSrc = OFFLINE ?
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMAAAADACAYAAABS3GwHAAAGGUlEQVR4AezTTY7kVBBFYYs9IBixAsZIDNgWi2BbDJAYswJGIBZBd6dKqVKq3HY630/Ei09qV2dV2vFunOvzzbZt/7swqPoOfBHg8+7+IVCTAAFq9m7rNwIEeAPhv5oECFCzd1u/ESgswBsB/5UmQIDS9VueAN6B0gQIULp+yxPAO1CaAAEq1m/nOwEC3FH4UJEAASq2buc7AQLcUfhQkQABKrZu5zsBAtxR+FCBwOOOBHgk4vdSBAhQqm7LPhIgwCMRv5ciQIBSdVv2kQABHon4vRSBQgKU6tWyJwkQ4CQot61JgABr9mqrkwS6C/D9L99uLgyuvgMn3+PLt3UX4HIyDyIwgAABBkCefoQAuwQIsIvGFxUIEKBCy3bcJUCAXTS+qECAABVatuMuAQLsovHFCgSOdiDAESHfL02AAEvXa7kjAgQ4IuT7pQkQYOl6LXdEIJwAP/z23eZal8HRCzn6+3ACtANgEgLHBAhwzMgdCxMgwMLlWu2YAAGOGbljYQIEWLhcqx0TIMAxo3x3SHyaAAFOo3LjigQIsGKrdjpNgACnUblxRQIEWLFVO50mQIDTqNyYgcCzGdML8OfPf22ueQyefeGi3Z9egGhA5clFgAC5+pK2MQECNAZqXC4CBMjVl7SNCSwkQGMyxpUgQIASNVtyjwAB9sj4ewkCBChRsyX3CBBgj4y/lyBAgBVqtsNlAgS4jM6DKxAgwAot2uEyAQJcRufBFQgQYIUW7XCZAAEuo/NgBAKvZiDAqwQ9n5oAAVLXJ/yrBAjwKkHPpyZAgNT1Cf8qAQK8StDzqQkkFiA1d+GDECBAkCLEmEOAAHO4OzUIAQIEKUKMOQQIMIe7U4MQIECQIp6K4eZmBAjQDKVBGQkQIGNrMjcjQIBmKA3KSIAAGVuTuRkBAjRDadAIAq3PIEBroualIkCAVHUJ25oAAVoTNS8VAQKkqkvY1gQI0JqoeakIJBIgFVdhkxAgQJKixOxDgAB9uJqahAABkhQlZh8CBOjD1dQkBAiQoSgZuxEgQDe0BmcgQIAMLcnYjQABuqE1OAMBAmRoScZuBAjQDa3BLQj0nkGA3oTND02AAKHrEa43AQL0Jmx+aAIECF2PcL0JEKA3YfNDEwgsQGhuwi1CgACLFGmNawQIcI2bpxYhQIBFirTGNQIEuMbNU4sQIEDEImUaRoAAw1A7KCIBAkRsRaZhBAgwDLWDIhIgQMRWZBpGgADDUDvoDIHR9xBgNHHnhSJAgFB1CDOaAAFGE3deKAIECFWHMKMJEGA0ceeFIhBIgFBchClCgABFirbmxwQI8DEXfy1CgABFirbmxwQI8DEXfy1CgAARipZhGgECTEPv4AgECBChBRmmESDANPQOjkCAABFakGEaAQJMQ+/gLwRmXwSY3YDzpxIgwFT8Dp9NgACzG3D+VAIEmIrf4bMJEGB2A86fSmCiAFP3djgCNwIEuGHwoyoBAlRt3t43AgS4YfCjKgECVG3e3jcCBLhhGPzDcWEIECBMFYLMIECAGdSdGYYAAcJUIcgMAgSYQd2ZYQgQIEwVNYJE2zK9AD/98ePmmscg2gv9bJ70Ajy7sPsReE+AAO9p+FyOAAHKVW7h9wQI8J6Gz+UIDBSgHFsLJyBAgAQlidiPAAH6sTU5AQECJChJxH4ECNCPrckJCBBgREnOCEuAAGGrEWwEgXAC/P3rv5trXQYjXupnzggnwDPh3YvAqwQI8CpBz6cmQIDU9cUPHz0hAaI3JF9XAgToitfw6AQIEL0h+boSIEBXvIZHJ0CA6A3J15VARwG65jYcgSYECNAEoyFZCRAga3NyNyHQXYB/fv9vc2Fw9R1o8pZ/ZUh3Ab5ytq8QmE6AAD0qMDMNAQKkqUrQHgQI0IOqmWkIECBNVYL2IECAHlTNTEOAAGmqyhE0W0oCZGtM3qYECNAUp2HZCBAgW2PyNiVAgKY4DctGgADZGpO3KYGGAjTNZRgCQwgQYAhmh0QlQICozcg1hAABhmB2SFQCBIjajFxDCBCgBWYz0hIgQNrqBG9BgAAtKJqRlgAB0lYneAsCBGhB0Yy0BAiQtroYwbOn+AQAAP//pNWbVwAAAAZJREFUAwCrzfj9qhYVbQAAAABJRU5ErkJggg=="
        : "./icon_maskable_192.png";

        navigator.mediaSession.metadata = new MediaMetadata({
            title: "Untitled",
            // artist:"Unknown",
            // album: "Unknown",
            artwork: [{ src: imgSrc }]
        });
        
        this.audioTag.pause();
        navigator.mediaSession.playbackState = "paused";

        navigator.mediaSession.setActionHandler("play", () => {
            this.audioTag.play();
            navigator.mediaSession.playbackState = "playing";
            this._onMediaSessionPlay();
        });
        navigator.mediaSession.setActionHandler("pause", () => {
            this.audioTag.pause();
            navigator.mediaSession.playbackState = "paused";
            this._onMediaSessionPause();
        });
        navigator.mediaSession.setActionHandler("stop", () => {
            this.audioTag.pause();
            navigator.mediaSession.playbackState = "paused";
            this._onMediaSessionStop();
        });
        navigator.mediaSession.setActionHandler("seekbackward", () => {
            this._onMediaSessionSeekBackward();
        });
        navigator.mediaSession.setActionHandler("seekforward", () => {
            this._onMediaSessionSeekForward();
        });
        navigator.mediaSession.setActionHandler("seekto", () => {
            this._onMediaSessionSeekTo();
        });
    }

    public playMediaSession(): void {
        this.audioTag.play();
        navigator.mediaSession.playbackState = "playing";
    }
    public pauseMediaSession(): void {
        this.audioTag.pause();
        navigator.mediaSession.playbackState = "paused";
    }
    public updateMediaSessionTitle(newTitle: string | undefined): void {
        if (navigator.mediaSession.metadata != null && newTitle != undefined) navigator.mediaSession.metadata.title = newTitle;
    }
}
