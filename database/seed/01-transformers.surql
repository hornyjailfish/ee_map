{
    let $roomId = SELECT VALUE id FROM ONLY electric_rooms WHERE name = "ТП-1" LIMIT 1;
    INSERT IGNORE INTO transformers [
        {
            name: "тр.1",
            room: $roomId
        },
        {
            name: "тр.2",
            room: $roomId
        },
        {
            name: "тр.3",
            room: $roomId
        },
        {
            name: "тр.4",
            room: $roomId
        },
    ];
};

{
    let $roomId = SELECT VALUE id FROM ONLY electric_rooms WHERE name = "ТП-2" LIMIT 1;
    INSERT IGNORE INTO transformers [
        {
            name: "тр.1",
            room: $roomId
        },
        {
            name: "тр.2",
            room: $roomId
        },
        {
            name: "тр.3",
            room: $roomId
        },
        {
            name: "тр.4",
            room: $roomId
        },
    ];
};

{
    let $roomId = SELECT VALUE id FROM ONLY electric_rooms WHERE name = "ТП-3" LIMIT 1;
    INSERT IGNORE INTO transformers [
        {
            name: "тр.1",
            room: $roomId
        },
        {
            name: "тр.2",
            room: $roomId
        },
        {
            name: "тр.3",
            room: $roomId
        },
        {
            name: "тр.4",
            room: $roomId
        },
    ];
};

{
    let $roomId = SELECT VALUE id FROM ONLY electric_rooms WHERE name = "ТП-4" LIMIT 1;
    INSERT IGNORE INTO transformers [
        {
            name: "тр.1",
            room: $roomId
        },
        {
            name: "тр.2",
            room: $roomId
        },
        {
            name: "тр.3",
            room: $roomId
        },
        {
            name: "тр.4",
            room: $roomId
        },
    ];
};
