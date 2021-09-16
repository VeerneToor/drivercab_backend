const functions = require('firebase-functions');
const admin = require("firebase-admin");


/**
 * Se inicializa firebase
 */
admin.initializeApp({
    credential: admin.credential.cert(
        require("./connection.json")
    ),
});


exports.listenerBookingNotifications = functions.firestore.document("bookings/{bookingId}").onWrite(async (change, context) => {
    const snapshot = change.after;
    const { state, userId, type, pickUpData } = snapshot.data();
    const firestore = admin.firestore();
    const userReference = firestore.collection("users").where('notifications', '==', true);

    if (state === "waiting") { // Entra aqui si el booking fue creado recientemente

        if (snapshot.data().isUpdated != null && snapshot.data().isUpdated != undefined) {
            return;
        }

        var driversTokens = [];

        /**
         * Trae a todos los usuarios que sean Drivers, esto solo
         * pasa si el pedido es un taxi
         */
        if (type == "DRIVER") {
            const drivers = (await userReference
                .where("isOnline", "==", true)
                .where("isActived", "==", true)
                .where("role", "==", "DRIVER").get());
            drivers.docs.forEach(user => driversTokens.push(user.data().fcmToken));

        /**
         * Busca a todos los usuarios que tengan @MultiServices y 
         * que sean @Delivery
         */
        } else {
            const deliveries = (await userReference
                .where("isOnline", "==", true)
                .where("isActived", "==", true)
                .where("role", "==", "DELIVERY").get());
            const multiServices = (await userReference
                .where("isOnline", "==", true)
                .where("isActived", "==", true)
                .where("isMultiService", "==", true).get());

            deliveries.docs.forEach( worker => {
                const currentWorker = worker.data();
                driversTokens.push(currentWorker.fcmToken);
            });
            multiServices.docs.forEach( worker => {
                const currentWorker = worker.data();
                driversTokens.push(currentWorker.fcmToken);
            });
        }


        const address = pickUpData['address'];

        const body = (type == "DELIVERY") ? `Comprar en: ${address}` : `Buscar en: ${address}`;

        await admin.messaging().sendMulticast({
            tokens: driversTokens,
            notification: {
                title: "Nuevo Servicio Pedido",
                body,
            },
            data: {
                title: "Nuevo Servicio Pedido",
                body,
            }
        });
        return;
    }

    if (state == "taked") {

        /**
         *  Inicia @Chat
         */
        await firestore.collection("chats").doc(snapshot.id).set({
            driverId: snapshot.data().driverId,
            userId,
        }, { merge: true });

        /**
         * Termina @Chat
         */

        const userDocument = (await userReference.doc(userId).get());
        const fcmUserToken = userDocument.data().fcmToken;

        admin.messaging().sendToDevice(fcmUserToken, {
            notification: {
                title: "Tu Servicio Fue Asignado",
                body: "Gracias por Usar de Nuestros Servicios"
            },
            data: {
                title: "Tu Servicio Fue Asignado",
                body: "Gracias por Usar de Nuestros Servicios"
            }
        });
        return;
    }
});


exports.listenerChats = functions.firestore.document("chats/{chatId}").onWrite(async (change, context) => {
    const { driverId, userId, messages } = change.after;

    if (driverId && userId && messages) {
        const currentMessages = Array.from(messages || []);

        if (currentMessages.length > 0) {
            const lastMessage = currentMessages[currentMessages.length - 1];

            const senderId = lastMessage.senderId;

            const userData = (await admin.firestore().collection("users").doc(userId).get()).data();
            const driverData = (await admin.firestore().collection("users").doc(driverId).get()).data();

            if (senderId === driverId) { // El que lo envió es driver
                admin.messaging().sendToDevice(userData.fcmToken, {
                    notification: {
                        title: driverData.fullName,
                        body: lastMessage.nessage,
                    }
                })
            } else {
                admin.messaging().sendToDevice(driverData.fcmToken, {
                    notification: {
                        title: userData.fullName,
                        body: lastMessage.message,
                    }
                })
            }
        }
    }
})
