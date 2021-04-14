export interface Card {
    id: number;
    shape: number;
    color: number;
    count: number;
    background: number;
}

export function getFullDeck() {
    let deck: Card[] = [];
    const variations = 3;
    let id = 0;

    for (let i = 0; i < variations; i++) {
        for (let j = 0; j < variations; j++) {
            for (let k = 0; k < variations; k++) {
                for (let h = 0; h < variations; h++) {
                    deck.push({
                        id: id++,
                        shape: i,
                        color: j,
                        count: k,
                        background: h,
                    } as Card);
                }
            }
        }
    }

    return deck;
}